provider "aws" {
  region = ""
}
# replace with your state strategy
terraform {
  backend "s3" {
    bucket = ""
    key    = ""
    region = ""
  }
}
