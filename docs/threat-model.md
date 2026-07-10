# Threat Model & Security Design

Scope: the Amrutam telemedicine backend (API, worker, data stores). Health data
is sensitive personal data (India DPDP Act / general PHI expectations), so
confidentiality, integrity and auditability are primary.

## 1. Data classification

| Class | Examples | Controls |
|-------|----------|----------|
| **Critical (PHI)** | consultation reason & clinical notes, prescriptions | AES-256-GCM field encryption at rest; decrypted only for participants; never logged; admins see metadata only |
| **Sensitive (PII)** | email, phone, name, DOB, address | field encryption + HMAC blind index for lookups; redacted in logs |
| **Secret** | passwords, MFA secrets, JWT/refresh, webhook & data-encryption keys | argon2id (passwords); encrypted (MFA secret); env/Secrets Manager; never in code, logs, or responses |
| **Restricted** | payments, audit logs | RBAC-gated; audit is append-only + tamper-evident |
| **Public** | doctor name, specialization, fee, rating | cacheable |

## 2. Attack surface

| Surface | Exposure | Mitigations |
|---------|----------|-------------|
| Public REST API | Internet via LB | TLS, WAF/rate-limit at edge + per-user/route app rate-limit, strict schema validation, RBAC |
| Auth endpoints | Internet | argon2id, account lockout, MFA, generic errors (no user enumeration), tighter rate limits |
| Payment webhook | Internet, unauthenticated | HMAC signature over raw body (constant-time), event-id de-dup, idempotent handlers |
| Data stores | Private subnets only | SGs allow only the app; encryption at rest + in transit; no public access |
| Secrets | Runtime | Secrets Manager injection, least-privilege IAM, rotation |
| Dependencies / supply chain | Build | `npm ci` (lockfile), `npm audit`, Trivy fs+image scans in CI, pinned base image |
| Async jobs | Internal | signed/trusted queue (Redis in VPC), idempotent processors |

## 3. OWASP API/Web Top-10 mitigations

| Risk | Mitigation |
|------|-----------|
| **Broken object-level authZ (BOLA)** | Every resource read/write re-checks ownership (patient/doctor participant checks; payment/prescription owner checks) — never trust an id from the client |
| **Broken authN** | Short-lived access JWT + rotating refresh tokens with **reuse detection** (revoke family on replay); argon2id; lockout; MFA step-up; separate audience for MFA challenge tokens |
| **Broken function-level authZ** | Centralised RBAC (`authorize(permission)`); permissions declared per route; privilege-escalation guard (public register can't create admins) |
| **Excessive data exposure** | DTOs whitelist fields; response schemas strip extras (fast-json-stringify); PHI decrypted only for participants |
| **Injection** | Parameterised SQL everywhere (no string-built queries with user data); AJV input validation; `additionalProperties:false` |
| **SSRF / broken resource consumption** | No user-supplied URLs fetched; body size limit; rate limiting; bounded pools; pagination caps |
| **Security misconfiguration** | Helmet headers, HSTS in prod, CORS allow-list, non-root container, minimal image, fail-fast config validation |
| **Vulnerable components** | CI dependency + image scanning, lockfile, Dependabot-ready |
| **Insufficient logging/monitoring** | Structured logs, metrics, traces, and a tamper-evident audit trail of every sensitive action |
| **Mass assignment** | Typed bodies with explicit allow-lists; role never taken from client on privileged paths |

## 4. Encryption & key management
- **In transit:** TLS everywhere (LB→client, app→RDS, app→Redis via `rediss://`).
- **At rest:** RDS & ElastiCache KMS encryption; **application field-level**
  AES-256-GCM for PII/PHI columns (defence-in-depth beyond disk encryption).
- **Key rotation:** a versioned key ring (`kid:key`) — encrypt with the active
  kid, decrypt any kid. Rotate by adding a new key + flipping the active kid;
  old ciphertext stays readable and is lazily/【batch】re-encrypted. JWT and
  webhook secrets rotate independently.
- **Blind index:** HMAC-SHA256 (separate derived key) enables equality lookups
  on encrypted email/phone without storing plaintext.

## 5. Audit & compliance
- Append-only `audit_logs` records actor, action, resource, outcome, IP, request
  id, and PII-free metadata for every sensitive action (login, booking,
  cancellation, prescription, refund, admin actions, refresh-reuse detection).
- Each row carries a SHA-256 **content hash** for tamper evidence; audit writes
  inside a domain transaction commit atomically with the action.
- Monthly partitioning enables long-term retention with cheap archival.

## 6. Abuse / fraud cases handled
- **Double booking** → row lock + partial unique index (see architecture §7).
- **Double charge** → idempotent gateway calls + unique payment per consultation.
- **Replayed requests** → idempotency plugin (at-most-once side effects).
- **Token theft** → refresh reuse detection revokes the whole token family.
- **Credential stuffing** → lockout + tight rate limits + MFA.
- **Slot hoarding** → holds expire (reaper) and time-boxed saga.

## 7. Residual risks / future work
- Edge WAF + bot management (assumed at the LB, out of app scope).
- Automated key-rotation job + envelope encryption via KMS data keys.
- Field-level access logging export to a SIEM; anomaly detection on audit stream.
- Per-tenant data isolation if multi-clinic tenancy is introduced.
