# Infrastructure as Code (AWS)

Terraform for the production deployment of the Amrutam telemedicine backend.

## Topology

```
Internet → ALB (HTTPS/TLS1.3) → ECS Fargate service (>=3 tasks, multi-AZ, autoscaled)
                                     ├─ RDS PostgreSQL 16 (Multi-AZ, encrypted, PITR)
                                     │    └─ read replica (analytics/search reads)
                                     ├─ ElastiCache Redis 7 (replication group, Multi-AZ, TLS)
                                     └─ Secrets Manager (runtime secrets, injected as env)
```

Design choices mapped to the assignment:

| Requirement            | How                                                                 |
|------------------------|---------------------------------------------------------------------|
| 99.95% availability    | Multi-AZ RDS + Redis, >=3 Fargate tasks across AZs, circuit-breaker deploys with rollback, autoscaling |
| Encryption             | RDS/Redis at-rest KMS encryption, Redis in-transit TLS, field-level app encryption keys in Secrets Manager |
| Secrets via env        | Secrets Manager values injected into the task as `secrets` (never in the image) |
| Scalability            | Target-tracking autoscaling (CPU 60%), read replica, storage autoscaling |
| Backup / DR            | 14-day automated backups + PITR, 7-day Redis snapshots, cross-region snapshot copy recommended |

## Usage

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in VPC/subnets/cert/image
terraform init
terraform plan
terraform apply
```

Migrations run as a one-off ECS task (or CI step) using the same image:
`node_modules/.bin/node-pg-migrate up` with `DATABASE_URL` from the secret.

> This is a deployable skeleton. For a real rollout add: Route53 record + WAF on
> the ALB, a dedicated KMS CMK, VPC flow logs, GuardDuty, and a separate ECS
> service/task definition for the BullMQ worker (`node dist/jobs/worker.js`).
