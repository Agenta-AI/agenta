# install dependencies
sudo apt update

# install docker
sudo apt install apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
apt-cache policy docker-ce
sudo apt install docker-ce

sudo usermod -aG docker ${USER}


# LOGOUT OR : To apply the new group membership, log out of the server and back in, or type the following:



# install docker-compose
mkdir -p ~/.docker/cli-plugins/
curl -SL https://github.com/docker/compose/releases/download/v2.18.1/docker-compose-linux-x86_64 -o ~/.docker/cli-plugins/docker-compose



# sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose -y # we need to check if we are downloading last stable versions


# clone agenta
ssh-keyscan -H github.com >> /home/ubuntu/.ssh/known_hosts
git clone https://github.com/Agenta-AI/agenta.git


## jq
# sudo apt install -y jq