variable "region" {
  type    = string
  default = "ap-south-1" # Mumbai — data residency for Indian health data
}

variable "environment" {
  type    = string
  default = "production"
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC id to deploy into."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for ECS tasks, RDS and ElastiCache (>=2 AZs)."
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnets for the ALB (>=2 AZs)."
}

variable "container_image" {
  type        = string
  description = "ECR image URI (e.g. <acct>.dkr.ecr.ap-south-1.amazonaws.com/amrutam:sha)."
}

variable "desired_count" {
  type    = number
  default = 3 # spread across AZs for the 99.95% availability target
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "redis_node_type" {
  type    = string
  default = "cache.r6g.large"
}

variable "certificate_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener."
}
