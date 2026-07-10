# 5-minute demo script

A suggested walkthrough for the submission video. Start the stack first:
`docker compose up --build` and `docker compose --profile seed run --rm seed`.

1. **(0:00) Overview (30s)** — one-line pitch + the architecture diagram
   (`docs/architecture.md`). Call out: stateless API, Postgres+Redis, worker tier,
   full observability.

2. **(0:30) API surface (30s)** — open `http://localhost:8080/docs`, scroll the
   tags (auth, doctors, availability, bookings, consultations, prescriptions,
   payments, admin). Mention OpenAPI is generated from code.

3. **(1:00) Auth + MFA (45s)** — register/login a patient (`/auth/login`), show
   the JWT; enrol MFA (`/auth/mfa/setup` → QR), then login shows the
   `mfaRequired` step. Show RBAC by calling an admin route as a patient → 403.

4. **(1:45) Search + availability (30s)** — `GET /doctors?specialization=ayurveda&sort=rating`
   (note it's cached + keyset-paginated), then `GET /doctors/:id/slots`.

5. **(2:15) Booking + idempotency (60s)** — `POST /bookings` with an
   `Idempotency-Key`; repeat the exact call → same response with
   `Idempotent-Replayed: true`. Show the consultation is `scheduled` and one
   payment `succeeded`.

6. **(3:15) Concurrency proof (45s)** — run the integration test live:
   `RUN_DB_TESTS=1 npx vitest run tests/integration` — six racers, exactly one
   booking, five 409s; DB has one active consultation.

7. **(4:00) Lifecycle + saga (30s)** — as the doctor: start → notes → complete;
   as the patient: review. Trigger a decline (fee ending in `.13`) to show
   compensation (slot freed, consultation cancelled).

8. **(4:30) Observability (30s)** — `/metrics` (latency histograms, booking
   counters), Jaeger trace spanning API→DB→Redis, Grafana panel; then
   `GET /admin/audit-logs` showing the tamper-evident trail.

9. **(5:00) Wrap** — CI pipeline (lint/typecheck/tests/Trivy) + Terraform for the
   AWS deployment.
