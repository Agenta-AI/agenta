#!/bin/bash
set -e

# Navigate to tests directory
cd tests/

# # Set up virtual environment
python3.12 -m venv venv
source venv/bin/activate

# # Install test dependencies
pip install -r requirements.test.txt

# # Ask the user which version of Agenta to install
echo "Which version of agenta would you like to install? (Provide path or VCS URL)"
read agenta_version

# # Install the selected Agenta version
pip install $agenta_version

# Ask the user for the host (default to http://localhost if not provided)
echo "Enter the host (default is http://localhost):"
read agenta_host
agenta_host=${agenta_host:-http://localhost}

# Set the environment variables for the target environment
AGENTA_HOST="$agenta_host" AGENTA="$agenta_version" pytest --env-file=.env -vv sdk/*
