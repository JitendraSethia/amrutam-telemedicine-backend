# Security Checklist

Status of security controls in this codebase. ✅ implemented · 🔶 partial/mocked
for the assignment · ⬜ documented, production follow-up.

## Authentication & session management
- ✅ argon2id password hashing (memory-hard, tuned cost)
- ✅ Password policy (length) at the edge; account **lockout** after repeated failures
- ✅ TOTP **MFA** (enrol via QR, verify, session step-up); enabling MFA revokes other sessions
- ✅ Short-lived access JWT (15m) + long-lived **rotating** refresh tokens
- ✅ Refresh-token **reuse detection** → revoke token family (theft response)
- ✅ MFA-challenge token isolated by a distinct JWT audience (cannot be used as API token)
- ✅ Logout (single session) and logout-all
- ✅ No user enumeration (generic errors + constant-time dummy verify on unknown user)

## Authorization
- ✅ **RBAC** enforced centrally (`authorize(permission)`); permissions declared per route
- ✅ Object-level authZ (participant/owner checks) on every consultation, prescription, payment
- ✅ Privilege-escalation guard: public registration cannot create doctor/admin privileges
- ✅ PHI minimisation: admins see consultation metadata, not clinical notes

## Input validation & output handling
- ✅ Schema validation on every route (TypeBox/AJV), `additionalProperties:false`, `removeAdditional`
- ✅ Parameterised SQL everywhere (no dynamic SQL with user input)
- ✅ Response DTOs whitelist fields; serializer strips extras
- ✅ Body size limit (1 MiB), pagination caps

## Data protection
- ✅ AES-256-GCM **field-level encryption** for PII/PHI at rest
- ✅ **Key rotation** via versioned key ring; blind index for encrypted-field lookups
- ✅ Secrets via env / Secrets Manager — none in source or images
- ✅ TLS in transit (app↔DB, app↔Redis `rediss://`, client↔LB); ⬜ mTLS internal (future)
- ✅ Log redaction of secrets/PII (authorization, cookies, email, tokens, passwords)

## Network & platform
- ✅ Helmet security headers; HSTS in production
- ✅ CORS allow-list (no wildcard with credentials in prod)
- ✅ Non-root container, multi-stage minimal image, healthcheck
- ✅ Data stores in private subnets; security groups restrict to the app only
- ⬜ Edge WAF + DDoS protection (assumed at LB)

## Rate limiting & abuse
- ✅ Global per-user/IP rate limit (Redis-backed) + tighter limits on auth/booking
- ✅ Fail-open on Redis outage (availability SLO) with alerting
- ✅ Idempotency prevents duplicate side effects; slot holds expire

## Idempotency & concurrency (fail-condition controls)
- ✅ `Idempotency-Key` required on `POST /bookings`, `/prescriptions`, `/availability`
- ✅ Durable claim (Postgres) + replay + reuse rejection + release-on-5xx
- ✅ Double-booking prevented by row lock + partial unique index
- ✅ Payment idempotency + unique-per-consultation constraint (no double charge)

## Auditing & monitoring
- ✅ Append-only, tamper-evident (row-hash) audit trail of sensitive actions
- ✅ Structured logs w/ correlation ids; Prometheus metrics; OpenTelemetry traces
- ✅ Health `/health` + readiness `/ready` (dependency checks)

## Supply chain & CI
- ✅ Lockfile + `npm ci`; `npm audit` in CI
- ✅ Trivy filesystem + image scanning (HIGH/CRITICAL) with SARIF upload
- ✅ Typecheck + lint + unit + integration tests gate merges
- ⬜ Image signing (cosign) + SBOM (future)

## Webhooks
- ✅ HMAC signature verification over raw body (constant-time compare)
- ✅ Event-id de-duplication; idempotent state transitions
