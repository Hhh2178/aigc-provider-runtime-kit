# Security Policy

## Supported Versions

`v0.1.x` is the current foundation line. APIs may change before `1.0`, but security fixes should be applied to the latest published version.

## Reporting A Vulnerability

Open a private security advisory on GitHub when available, or contact the repository owner through GitHub. Do not publish proof-of-concept exploit details in a public issue before a fix is available.

## Secret Handling

Never commit:

- Provider API keys.
- RunningHub keys.
- `.env` files.
- Private keys or certificates.
- Customer configuration, server output, or deployment credentials.

The repository `.gitignore` intentionally blocks common secret file patterns such as `.env`, `*.pem`, and `*.key`.

## Runtime Boundary

This package provides reusable client and schema helpers. Host applications remain responsible for:

- Storing credentials securely.
- Enforcing user permissions.
- Rate limiting and quota controls.
- Auditing provider calls.
- Network egress restrictions.
