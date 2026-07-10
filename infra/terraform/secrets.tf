# Secrets are stored in AWS Secrets Manager and injected into the container at
# runtime (never baked into the image or committed). The app reads them as env
# vars (12-factor). Rotation is configured per-secret in production.

resource "random_password" "jwt_access" {
  length  = 48
  special = false
}
resource "random_password" "jwt_refresh" {
  length  = 48
  special = false
}
resource "random_password" "webhook" {
  length  = 32
  special = false
}

# The field-level data-encryption key ring. Rotate by ADDING a new versioned
# key and flipping DATA_ENCRYPTION_ACTIVE_KID — old ciphertext stays readable.
resource "random_password" "data_key_v1" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name        = "${local.name}/app"
  description = "Amrutam backend runtime secrets"
  # kms_key_id defaults to the account CMK; set a dedicated CMK in prod.
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL               = "postgres://amrutam:${random_password.db.result}@${aws_db_instance.pg.endpoint}/amrutam"
    DATABASE_REPLICA_URL       = "postgres://amrutam:${random_password.db.result}@${aws_db_instance.pg_replica.endpoint}/amrutam"
    REDIS_URL                  = "rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
    JWT_ACCESS_SECRET          = random_password.jwt_access.result
    JWT_REFRESH_SECRET         = random_password.jwt_refresh.result
    PAYMENT_WEBHOOK_SECRET     = random_password.webhook.result
    DATA_ENCRYPTION_KEYS       = "v1:${base64encode(random_password.data_key_v1.result)}"
    DATA_ENCRYPTION_ACTIVE_KID = "v1"
  })
}
