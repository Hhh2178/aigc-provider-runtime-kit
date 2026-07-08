# Secrets And Access Policy

## Forbidden In Git

- `.env` and `.env.*`
- Provider API keys
- RunningHub keys
- SSH keys
- Cloud credentials
- Real customer/provider configuration
- Server logs containing tokens or internal URLs

## Templates

Use `.env.example` for non-secret variable names only. Do not include real values.

## Exposure Response

If a secret is committed:

1. Stop work.
2. Notify the user.
3. Rotate the secret outside this repository.
4. Remove it from history only with explicit approval.
