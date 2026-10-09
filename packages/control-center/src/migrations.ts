export interface MigrationDefinition {
  id: string;
  sql: string;
}

/**
 * Fresh, neutral schema for the control center. Deliberately does not reuse the
 * legacy application's table names; column semantics are kept compatible so
 * records can be migrated with plain INSERTs later.
 */
export const MIGRATIONS: MigrationDefinition[] = [
  {
    id: "001_core.sql",
    sql: `
create table if not exists cc_providers (
  id text primary key,
  tenant_id text not null default 'default',
  sort_order integer not null default 0,
  name text not null,
  base_url text not null default '',
  protocol text not null default 'openai',
  enabled boolean not null default false,
  api_key_cipher text not null default '',
  api_key_preview text not null default '',
  last_probe_status text not null default '',
  last_probe_message text not null default '',
  last_fetched_at timestamptz,
  rh_apps jsonb not null default '[]'::jsonb,
  rh_workflows jsonb not null default '[]'::jsonb,
  rh_groups jsonb not null default '[]'::jsonb,
  rh_key_pool jsonb not null default '[]'::jsonb,
  ms_loras jsonb not null default '[]'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cc_models (
  id text primary key,
  tenant_id text not null default 'default',
  sort_order integer not null default 0,
  provider_id text not null references cc_providers(id) on delete cascade,
  model_id text not null,
  display_name text not null default '',
  capability text not null check (capability in ('chat', 'image', 'video', 'audio')),
  enabled boolean not null default false,
  execution_mode text not null default 'worker_queue' check (execution_mode in ('sync_inline', 'async_poll', 'async_poll_then_final_lookup', 'worker_queue')),
  input_profile text not null default 'prompt',
  input_capabilities jsonb not null default '{}'::jsonb,
  capability_tags jsonb not null default '[]'::jsonb,
  test_state jsonb not null default '{}'::jsonb,
  parameter_schema jsonb not null default '{}'::jsonb,
  advanced_config jsonb not null default '{}'::jsonb,
  protocol_override text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cc_admin_users (
  id text primary key,
  email text not null unique,
  name text not null default '',
  role text not null check (role in ('admin', 'member')) default 'admin',
  password_hash text not null,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cc_sessions (
  id text primary key,
  user_id text not null references cc_admin_users(id) on delete cascade,
  user_agent text not null default '',
  ip text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists cc_audit_logs (
  id text primary key,
  actor_id text references cc_admin_users(id) on delete set null,
  actor_email text not null default '',
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  summary text not null default '',
  ip text not null default '',
  user_agent text not null default '',
  request_id text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists cc_schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create index if not exists idx_cc_providers_protocol on cc_providers(protocol);
create index if not exists idx_cc_providers_tenant on cc_providers(tenant_id);
create index if not exists idx_cc_models_provider_id on cc_models(provider_id);
create index if not exists idx_cc_sessions_user_id on cc_sessions(user_id);
create index if not exists idx_cc_sessions_expires on cc_sessions(expires_at);
create index if not exists idx_cc_audit_logs_created_at on cc_audit_logs(created_at desc);
`
  }
];
