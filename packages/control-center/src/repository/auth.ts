import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { SqlExecutor } from "../db.js";

export interface AdminUserRecord {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  disabled?: boolean | undefined;
  createdAt?: number | undefined;
}

export interface AdminSessionRecord {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  user?: AdminUserRecord;
}

export interface AuthRepository {
  ensureBootstrapAdmin(input: { email: string; password: string }): Promise<AdminUserRecord>;
  verifyLogin(email: string, password: string): Promise<AdminUserRecord | null>;
  createSession(input: { userId: string; userAgent: string; ip: string; ttlHours: number }): Promise<AdminSessionRecord>;
  readSession(sessionId: string): Promise<AdminSessionRecord | null>;
  revokeSession(sessionId: string): Promise<void>;
  revokeExpiredSessions(now?: Date): Promise<void>;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  disabled?: boolean;
}

export function hashAdminPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password.normalize("NFKC"), salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyAdminPassword(password: string, storedHash: string) {
  const [scheme, salt, digest] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const derived = scryptSync(password.normalize("NFKC"), salt, 64).toString("hex");
  const expected = Buffer.from(digest, "hex");
  const actual = Buffer.from(derived, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createAuthRepository(executor: SqlExecutor): AuthRepository {
  function toUserRecord(row: UserRow | Record<string, unknown>): AdminUserRecord {
    return {
      id: String(row.id ?? ""),
      email: String(row.email ?? ""),
      name: String(row.name ?? ""),
      role: row.role === "member" ? "member" : "admin",
      disabled: row.disabled === true,
      createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : undefined
    } satisfies AdminUserRecord;
  }

  return {
    async ensureBootstrapAdmin({ email, password }) {
      const existing = await executor.query(`select * from cc_admin_users where lower(email) = lower($1) limit 1`, [email]);
      if (existing.rows[0]) return toUserRecord(existing.rows[0]);
      const id = `admin-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const inserted = await executor.query(
        `insert into cc_admin_users (id, email, name, role, password_hash) values ($1,$2,$3,'admin',$4)
         on conflict (email) do update set updated_at = now()
         returning *`,
        [id, email.toLowerCase(), "Administrator", hashAdminPassword(password)]
      );
      return toUserRecord(inserted.rows[0] ?? ({} as UserRow));
    },
    async verifyLogin(email, password) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const result = await executor.query(
        "select * from cc_admin_users where lower(email) = $1 and disabled = false limit 1",
        [normalizedEmail]
      );
      const row = result.rows[0];
      if (!row) return null;
      if (!verifyAdminPassword(password, String(row.password_hash ?? ""))) return null;
      return toUserRecord(row as UserRow);
    },
    async createSession({ userId, userAgent, ip, ttlHours }) {
      const id = `ccs-${randomBytes(24).toString("hex")}`;
      const result = await executor.query(
        `insert into cc_sessions (id, user_id, user_agent, ip, expires_at)
         values ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)
         returning *`,
        [id, userId, userAgent || "", ip || "", String(Math.max(1, Math.floor(ttlHours)))]
      );
      const row = result.rows[0];
      return {
        id: String(row?.id ?? id),
        userId,
        createdAt: row?.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
        expiresAt: row?.expires_at ? new Date(String(row.expires_at)).getTime() : Date.now() + ttlHours * 3600_000
      };
    },
    async readSession(sessionId) {
      const normalized = String(sessionId || "").trim();
      if (!normalized) return null;
      const result = await executor.query(
        `select s.id as session_id, s.user_id, s.created_at, s.expires_at, u.id as uid, u.email, u.name, u.role, u.disabled
         from cc_sessions s join cc_admin_users u on u.id = s.user_id
         where s.id = $1 and s.expires_at > now()`,
        [normalized]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: String(row.session_id),
        userId: String(row.user_id),
        createdAt: new Date(String(row.created_at)).getTime(),
        expiresAt: new Date(String(row.expires_at)).getTime(),
        user: {
          id: String(row.uid),
          email: String(row.email),
          name: String(row.name),
          role: row.role === "member" ? "member" : "admin",
          disabled: row.disabled === true
        }
      };
    },
    async revokeSession(sessionId) {
      await executor.query("delete from cc_sessions where id = $1", [String(sessionId || "").trim()]);
    },
    async revokeExpiredSessions(now = new Date()) {
      await executor.query("delete from cc_sessions where expires_at <= $1", [now]);
    }
  };
}
