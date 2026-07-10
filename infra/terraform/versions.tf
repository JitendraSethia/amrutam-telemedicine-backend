terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state with locking. Configure per environment.
  # backend "s3" {
  #   bucket         = "amrutam-tf-state"
  #   key            = "telemedicine/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "amrutam-tf-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "amrutam-telemedicine"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
