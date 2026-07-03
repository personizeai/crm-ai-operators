# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | ✓         |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **security@personize.ai** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Affected versions
4. Any known mitigations

You will receive an acknowledgment within 48 hours and a remediation timeline within 5 business days.

## Scope

### In scope
- Authentication / authorization bypass in the MCP server or CLI
- Credential leakage through log output, error messages, or audit files
- Injection vulnerabilities via untrusted CRM data processed by `aiPrompt`
- Insecure default configurations in `.env.example` or manifests

### Out of scope
- Vulnerabilities in upstream dependencies (report to the dependency maintainer)
- Theoretical risks with no exploit path
- Issues that require physical access to the host

## Security Design Notes

- **No credentials stored by this library.** `PERSONIZE_SECRET_KEY` is the only secret; it is read from env at runtime and never written to disk by any operation.
- **DRY_RUN=true by default** in `.env.example`. Real writes require explicitly setting `DRY_RUN=false`.
- **Audit log** (`data/audit/`) records every operation run locally. It contains operation names, timestamps, and outcomes — not contact PII or CRM credentials.
- **CRM passthrough** calls go through Personize's API (`/api/v1/crm/{crm}/passthrough`). This library never holds CRM OAuth tokens directly.
- **AI prompt outputs** are Zod-validated before any property is written. Invalid schema outputs are rejected with a structured error, not silently coerced.
