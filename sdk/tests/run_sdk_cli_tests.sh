#!/bin/bash

set -e

# Function to prompt for a variable if not already set
check_and_request_var() {
  local var_name=$1
  local var_value=${!var_name}  # Use indirect variable reference to get value
  if [ -z "$var_value" ]; then
    read -p "Enter value for $var_name: " var_value
    export $var_name="$var_value"
    export BASE_URL="http://127.0.0.1" # required for sdk routing test suites
  fi
}

# Check for required variables and prompt if missing
check_and_request_var "OPENAI_API_KEY"
check_and_request_var "AGENTA_HOST"

# Run test commands
pytest -n 2 -v ./management/* ./sdk_routing/* 
