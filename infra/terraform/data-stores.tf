# ── RDS PostgreSQL (Multi-AZ, encrypted, automated backups) ────────────────────
resource "aws_db_subnet_group" "pg" {
  name       = "${local.name}-pg"
  subnet_ids = var.private_subnet_ids
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "pg" {
  identifier     = "${local.name}-pg"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = 100
  max_allocated_storage = 1000 # storage autoscaling
  storage_type          = "gp3"
  storage_encrypted     = true # encryption at rest (KMS)

  db_name  = "amrutam"
  username = "amrutam"
  password = random_password.db.result

  multi_az                     = true # synchronous standby → survives an AZ loss
  db_subnet_group_name         = aws_db_subnet_group.pg.name
  vpc_security_group_ids       = [aws_security_group.data.id]
  backup_retention_period      = 14 # point-in-time recovery window (DR)
  backup_window                = "18:00-19:00"
  maintenance_window           = "Sun:19:30-Sun:20:30"
  deletion_protection          = true
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  copy_tags_to_snapshot        = true
  # A read replica offloads analytics/search reads (see DATABASE_REPLICA_URL).
}

resource "aws_db_instance" "pg_replica" {
  identifier          = "${local.name}-pg-ro"
  instance_class      = var.db_instance_class
  replicate_source_db = aws_db_instance.pg.identifier
  publicly_accessible = false
  skip_final_snapshot = true
}

# ── ElastiCache Redis (replication group, Multi-AZ, encrypted) ─────────────────
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name}-redis"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name}-redis"
  description          = "Amrutam cache / rate-limit / idempotency / queues"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_clusters   = 2 # primary + replica

  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.data.id]
  snapshot_retention_limit = 7
}
