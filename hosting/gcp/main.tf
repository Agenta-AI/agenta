terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
      version = "4.79.0"
    }
  }
}

provider "google" {
  project = "${var.project_id}"
  region = "us-central1" 
  zone = "us-central1-a"
  credentials = "./credentials.json"
}

variable "project_id" {
    type = string
    description = "Your Project ID obtained from Google Cloud Console. Without it, this Compute Instance cannot be created."
}
