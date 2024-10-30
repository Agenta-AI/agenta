#!/bin/bash

# Directory containing the Cypress files
CYPRESS_DIR="cypress"

# Function to add file content with header
add_file_content() {
    local file_path="$1"
    if [ -f "$file_path" ]; then
        echo "/***** $file_path **/"
        cat "$file_path"
        echo
    else
        echo "Warning: File not found - $file_path" >&2
    fi
}

# Concatenate all files
(
    # e2e directory files
    for file in ${CYPRESS_DIR}/e2e/*.cy.ts; do
        if [ -f "$file" ]; then
            add_file_content "$file"
        fi
    done

    # support directory files
    for file in ${CYPRESS_DIR}/support/commands/*.ts; do
        if [ -f "$file" ]; then
            add_file_content "$file"
        fi
    done

    # support/e2e.ts file
    add_file_content "${CYPRESS_DIR}/support/e2e.ts"
    add_file_content "cypress.config.ts"
) | pbcopy

echo "All specified Cypress files have been concatenated and copied to clipboard."