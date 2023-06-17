resource "aws_eip" "agenta_eip" {
  domain = "vpc"

  instance = aws_instance.agenta.id
}

resource "aws_instance" "agenta" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t2.medium"
  key_name      = "agenta-dev"

  vpc_security_group_ids = [aws_security_group.agenta_instance_sg.id]

  tags = {
    Name = "agenta-instance"
  }
}

resource "aws_ebs_volume" "agenta_ebs" {
  availability_zone = aws_instance.agenta.availability_zone
  size              = 100
  type              = "gp2"  # General Purpose SSD
  tags = {
    Name = "agenta-volume"
  }
}

resource "aws_volume_attachment" "ebs_att" {
  device_name = "/dev/sdh"
  volume_id   = aws_ebs_volume.agenta_ebs.id
  instance_id = aws_instance.agenta.id
}
