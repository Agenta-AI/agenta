#!/bin/bash

DOCKER_CERTS_DIR="certs"

# ACME_FILE="acme.json"
# DOMAIN="registry.agenta.ai"
# CRT_FILE="/certs/domain.crt"
# KEY_FILE="/certs/domain.key"

if [ ! -d "$DOCKER_CERTS_DIR" ]; then
    mkdir "$DOCKER_CERTS_DIR"
fi

jq -c '.myResolver.Certificates[] | select(.domain.main == "'$DOMAIN'")' $ACME_FILE | while read -r item; do
    # Extract certificate and key for the specified domain
    CERT=$(echo $item | jq -r '.certificate')
    KEY=$(echo $item | jq -r '.key')

    # Save them to separate files
    echo "$CERT" > $CRT_FILE
    echo "$KEY" > $KEY_FILE
done