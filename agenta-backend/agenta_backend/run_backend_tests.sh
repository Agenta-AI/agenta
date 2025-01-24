#!/bin/bash

set -e

# Function to prompt for a variable if not already set
check_and_request_var() {
  local var_name=$1
  local default_value=$2
  local var_value=${!var_name}  # Use indirect variable reference to get value
  if [ -z "$var_value" ]; then
    read -p "Enter value for $var_name (default: $default_value): " input_value
    var_value=${input_value:-$default_value}  # Use input value or default
    export $var_name="$var_value"
  fi
}

# Check for required variables and prompt if missing
check_and_request_var "AGENTA_HOST" "http://localhost"

pytest -v --capture=no ./tests/auth/* ./tests/admin/* ./tests/apps/* 


