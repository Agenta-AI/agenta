#!/bin/bash
set -e  # Exit on any error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Agenta Deployment Script${NC}"
echo -e "${BLUE}Server: agenta.bravetech.io${NC}"
echo -e "${BLUE}========================================${NC}"

# Function to print step headers
print_step() {
    echo ""
    echo -e "${GREEN}==== $1 ====${NC}"
}

# Step 1: Update System
print_step "Step 1: Updating system packages"
apt update && apt upgrade -y

# Step 2: Install Essential Tools
print_step "Step 2: Installing essential tools"
apt install -y curl git vim ufw

# Step 3: Install Docker
print_step "Step 3: Installing Docker"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    echo "Docker already installed"
fi

# Step 4: Install Docker Compose
print_step "Step 4: Installing Docker Compose plugin"
apt install -y docker-compose-plugin

# Enable Docker
systemctl enable docker
systemctl start docker

# Verify installations
docker --version
docker compose version

# Step 5: Clone Agenta Repository
print_step "Step 5: Cloning Agenta repository"
if [ ! -d "/opt/agenta" ]; then
    mkdir -p /opt/agenta
    cd /opt/agenta
    git clone https://github.com/The-Edgar/agenta.git .
else
    echo "Directory /opt/agenta already exists"
    cd /opt/agenta
    git pull origin main
fi

# Step 6: Create SSL Certificate Directory
print_step "Step 6: Setting up SSL certificates directory"
mkdir -p /opt/agenta/ssl_certificates
touch /opt/agenta/ssl_certificates/acme.json
chmod 600 /opt/agenta/ssl_certificates/acme.json
ls -la /opt/agenta/ssl_certificates/

# Step 7: Generate Secure Keys
print_step "Step 7: Generating secure keys"
AUTH_KEY=$(openssl rand -base64 32)
CRYPT_KEY=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
RABBITMQ_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)

echo ""
echo "Generated credentials (save these securely):"
echo "AUTH_KEY=$AUTH_KEY"
echo "CRYPT_KEY=$CRYPT_KEY"
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
echo "RABBITMQ_PASSWORD=$RABBITMQ_PASSWORD"

# Step 8: Configure Environment
print_step "Step 8: Configuring environment variables"
cd /opt/agenta/hosting/docker-compose/oss

if [ ! -f ".env.oss.gh" ]; then
    cp env.oss.gh.example .env.oss.gh

    # Update environment file with generated values
    sed -i "s|TRAEFIK_DOMAIN=.*|TRAEFIK_DOMAIN=agenta.bravetech.io|g" .env.oss.gh
    sed -i "s|TRAEFIK_PROTOCOL=.*|TRAEFIK_PROTOCOL=https|g" .env.oss.gh
    sed -i "s|AGENTA_API_URL=.*|AGENTA_API_URL=https://agenta.bravetech.io/api|g" .env.oss.gh
    sed -i "s|AGENTA_WEB_URL=.*|AGENTA_WEB_URL=https://agenta.bravetech.io|g" .env.oss.gh
    sed -i "s|AGENTA_SERVICES_URL=.*|AGENTA_SERVICES_URL=https://agenta.bravetech.io/services|g" .env.oss.gh
    sed -i "s|AGENTA_AUTH_KEY=.*|AGENTA_AUTH_KEY=$AUTH_KEY|g" .env.oss.gh
    sed -i "s|AGENTA_CRYPT_KEY=.*|AGENTA_CRYPT_KEY=$CRYPT_KEY|g" .env.oss.gh
    sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|g" .env.oss.gh
    sed -i "s|RABBITMQ_DEFAULT_PASS=.*|RABBITMQ_DEFAULT_PASS=$RABBITMQ_PASSWORD|g" .env.oss.gh
    sed -i "s|AGENTA_SSL_DIR=.*|AGENTA_SSL_DIR=/opt/agenta/ssl_certificates|g" .env.oss.gh

    # Update database URIs with password
    sed -i "s|postgresql://agenta_admin:[^@]*@|postgresql://agenta_admin:$POSTGRES_PASSWORD@|g" .env.oss.gh
    sed -i "s|postgresql+asyncpg://agenta_admin:[^@]*@|postgresql+asyncpg://agenta_admin:$POSTGRES_PASSWORD@|g" .env.oss.gh

    # Update RabbitMQ URL
    sed -i "s|amqp://agenta_rabbit:[^@]*@|amqp://agenta_rabbit:$RABBITMQ_PASSWORD@|g" .env.oss.gh

    echo "Environment file created and configured"
else
    echo ".env.oss.gh already exists, skipping..."
fi

# Step 9: Configure Traefik Email (already configured locally)
print_step "Step 9: Traefik SSL email configured"
echo "Email already set to: edgar@bravetech.io"

# Step 10: Configure Firewall
print_step "Step 10: Configuring firewall"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status

# Step 11: Pull Docker Images
print_step "Step 11: Pulling Docker images (this may take 5-10 minutes)"
cd /opt/agenta/hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml --env-file .env.oss.gh pull

# Step 12: Start Services
print_step "Step 12: Starting Agenta services"
docker compose -f docker-compose.gh.ssl.yml --env-file .env.oss.gh up -d

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Started!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Services are starting up. This may take 2-5 minutes."
echo ""
echo "Monitor logs with:"
echo "  cd /opt/agenta/hosting/docker-compose/oss"
echo "  docker compose -f docker-compose.gh.ssl.yml logs -f"
echo ""
echo "Check status with:"
echo "  docker compose -f docker-compose.gh.ssl.yml ps"
echo ""
echo "Once ready, visit: https://agenta.bravetech.io"
echo ""
echo -e "${BLUE}Generated credentials saved above - copy them to a secure location!${NC}"
