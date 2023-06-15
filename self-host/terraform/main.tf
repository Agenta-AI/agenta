provider "aws" {
  region = "eu-central-1"
}

terraform {
  backend "s3" {
    bucket = "terraform-state-0935" # replace with your bucket name
    key    = "terraform/terraform.tfstate"
    region = "eu-central-1"
  }
}
