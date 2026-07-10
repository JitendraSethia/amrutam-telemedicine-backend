output "alb_dns_name" {
  description = "Public DNS of the load balancer (point your Route53 record here)."
  value       = aws_lb.this.dns_name
}

output "db_endpoint" {
  description = "Primary RDS endpoint."
  value       = aws_db_instance.pg.endpoint
}

output "db_replica_endpoint" {
  description = "Read-replica RDS endpoint."
  value       = aws_db_instance.pg_replica.endpoint
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "app_secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "ecs_cluster" {
  value = aws_ecs_cluster.this.name
}
