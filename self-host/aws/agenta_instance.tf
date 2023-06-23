resource "aws_instance" "agenta" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t2.medium"
  user_data     = file("instance-setup.sh")
  #   key_name      = aws_key_pair.agenta_key.key_name // uncomment this in case you need to ssh into the instance

  vpc_security_group_ids = [aws_security_group.agenta_instance_sg.id]

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

resource "aws_ebs_volume" "agenta_ebs" {
  availability_zone = aws_instance.agenta.availability_zone
  size              = 10
  type              = "gp2" # General Purpose SSD
  tags = {
    Name = "agenta-volume"
  }
}

resource "aws_volume_attachment" "ebs_att" {
  device_name = "/dev/sdh"
  volume_id   = aws_ebs_volume.agenta_ebs.id
  instance_id = aws_instance.agenta.id
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

output "open_in_browser_this_ip" {
  value       = "http://${aws_eip.agenta_eip.public_ip}"
  description = "Open this link in your browser to access Agenta, you need to wait a few minutes for services to start"
}

# uncomment this in case you need to ssh into the instance
# resource "aws_key_pair" "agenta_key" {
#   key_name   = "agenta-key"
#   public_key = file("~/.ssh/id_rsa_agenta.pub")
# }
