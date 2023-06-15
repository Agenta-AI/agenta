echo ~/.ssh/id_rsa_agenta > /home/ubuntu/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
ssh-keyscan -H github.com >> /home/ubuntu/.ssh/known_hosts
git clone git@github.com:Agenta-AI/agenta.git

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose -y # we need to check if we are downloading last stable versions

sudo usermod -aG docker ubuntu

sudo systemctl start docker
sudo systemctl status docker


## jq
sudo apt install -y jq