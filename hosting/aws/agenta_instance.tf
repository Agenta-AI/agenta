resource "aws_instance" "agenta" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t2.medium"
  user_data     = templatefile("instance-setup.sh", { AGENTA_API_URL = var.AGENTA_API_URL })
  # key_name = aws_key_pair.agenta_key.key_name // uncomment this if you need to ssh into the instance

  vpc_security_group_ids = [aws_security_group.agenta_instance_sg.id]

  root_block_device {
    volume_size = 50
    volume_type = "gp2"
  }

  tags = {
    Name = "agenta-instance"
  }
}

resource "aws_eip" "agenta_eip" {
  domain = "vpc"

  instance = aws_instance.agenta.id
}

resource "aws_eip_association" "eip_assoc" {
  instance_id   = aws_instance.agenta.id
  allocation_id = aws_eip.agenta_eip.id
}

data "aws_ami" "ubuntu" {
  most_recent = true
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  owners = ["099720109477"]
}

output "open_in_browser_this_link" {
  value       = "\nOpen the link below in your browser to access Agenta. Wait a few minutes for services to start.\n\nImportant: If you provided a domain name, access Agenta using that domain. Ensure the domain points to this IP address: ${aws_eip.agenta_eip.public_ip}\n\nLink: http://${coalesce(var.AGENTA_API_URL, aws_eip.agenta_eip.public_ip)}"
}

variable "AGENTA_API_URL" {
  description = "Enter a domain name (without http or www, e.g., agenta.ai) or leave empty."

  validation {
    condition     = var.AGENTA_API_URL == "" || can(regex("^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$", var.AGENTA_API_URL))
    error_message = "Provide a valid domain name or leave it empty."
  }
}

# # uncomment this if you need to ssh into the instance
# resource "aws_key_pair" "agenta_key" {
#   key_name   = "agenta-key"
#   public_key = file("~/.ssh/id_rsa_agenta.pub")
# }
