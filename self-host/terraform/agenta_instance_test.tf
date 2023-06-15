variable "private_key_path" {
  description = "Path to the private key file"
  default     = "~/.ssh/id_rsa_agenta"
}


resource "aws_eip" "ip" {
  domain = "vpc"

  instance = aws_instance.example.id
}

resource "aws_instance" "example" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t2.medium"
  key_name      = "dev-agenta-keypair"

#   user_data = file("setup.sh")

  vpc_security_group_ids = [aws_security_group.agenta_instance_sg.id]

  tags = {
    Name = "example-instance"
  }
}
