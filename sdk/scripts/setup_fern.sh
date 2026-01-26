#!/bin/bash

# Fern SDK Generation Script
# Generates Python SDK client from Agenta's OpenAPI spec
#
# Prerequisites:
#   - fern CLI installed globally (npm install -g fern-api)
#   - jq installed for JSON manipulation
#
# Usage:
#   ./setup_fern.sh [openapi_url]
#   Default URL: https://cloud.agenta.ai/api/openapi.json

set -e

# Helper function for error handling
handle_error() {
  echo "Error on line $1"
  exit 1
}
trap 'handle_error $LINENO' ERR

# Configuration
ORGANIZATION_NAME="agenta"
DEFAULT_OPENAPI_URL="https://cloud.agenta.ai/api/openapi.json"
OPENAPI_URL="${1:-$DEFAULT_OPENAPI_URL}"

# Get the script directory and navigate to client folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")/agenta/client"

echo "=== Fern SDK Generation ==="
echo "OpenAPI URL: $OPENAPI_URL"
echo "Client directory: $CLIENT_DIR"
echo ""

# Step 0: Navigate to the client folder
cd "$CLIENT_DIR" || { echo "Client folder not found: $CLIENT_DIR"; exit 1; }

# Step 1: Check prerequisites
echo "Checking prerequisites..."
if ! command -v fern >/dev/null 2>&1; then
  echo "Error: Fern is not installed. Install with: npm install -g fern-api"
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is not installed. Install with: apt install jq (or brew install jq)"
  exit 1
fi
echo "Prerequisites OK"
echo ""

# Step 2: Clean up previous fern directory
echo "Cleaning up previous ./fern directory..."
rm -rf ./fern
echo ""

# Step 3: Initialize Fern
echo "Initializing Fern..."
fern init --organization "$ORGANIZATION_NAME"
echo ""

# Step 4: Download OpenAPI spec
echo "Downloading OpenAPI spec..."
mkdir -p ./fern/openapi
curl -s "$OPENAPI_URL" -o ./fern/openapi/openapi.json
if [ ! -s "./fern/openapi/openapi.json" ]; then
  echo "Error: Failed to download OpenAPI spec"
  exit 1
fi
echo "Downloaded OpenAPI spec"
echo ""

# Step 5: Add the Fern Python SDK
echo "Adding Fern Python SDK..."
fern add fern-python-sdk
echo ""

# Step 6: Configure generators.yml
echo "Configuring generators.yml..."
generators_file="./fern/generators.yml"
if [ ! -f "$generators_file" ]; then
  echo "Error: generators.yml not found!"
  exit 1
fi

# Extract the Python SDK version
latest_version=$(grep -o 'version: [^ ]*' "$generators_file" | tail -1 | cut -d' ' -f2)
if [ -z "$latest_version" ]; then
  echo "Warning: Could not extract SDK version, using default"
  latest_version="4.48.0"
fi

# Rewrite generators.yml with correct format
cat > "$generators_file" <<EOL
# yaml-language-server: \$schema=https://schema.buildwithfern.dev/generators-yml.json
api:
  specs:
    - openapi: openapi/openapi.json

default-group: local
groups:
  local:
    generators:
      - name: fernapi/fern-python-sdk
        version: $latest_version
        output:
          location: local-file-system
          path: ../backend
EOL
echo "Configured generators.yml with Python SDK version: $latest_version"
echo ""

# Step 7: Patch OpenAPI spec if needed
echo "Patching OpenAPI spec..."
OPENAPI_FILE="./fern/openapi/openapi.json"

# Note: OpenAPI patching (removing deprecated paths, fixing operationIds) should be
# done at the API level, not here. See PR #3441 for the API-level fixes.
# This step is kept as a placeholder for any future patches needed.

echo "OpenAPI spec ready"
echo ""

# Step 8: Generate the client code
echo "Generating SDK..."
yes | fern generate || {
  echo "Error: Fern generate failed"
  exit 1
}
echo ""

# Step 9: Fix recursive type definitions (Pydantic compatibility)
echo "Fixing recursive type definitions..."

fix_recursive_types() {
  local file="$1"
  if [ -f "$file" ]; then
    # Replace self-referential types with typing.Any
    sed -i.bak 's/typing\.Optional\["FullJsonInput"\]/typing.Any/g' "$file"
    sed -i.bak 's/typing\.Optional\["FullJsonOutput"\]/typing.Any/g' "$file"
    sed -i.bak 's/typing\.Optional\["LabelJsonInput"\]/typing.Any/g' "$file"
    sed -i.bak 's/typing\.Optional\["LabelJsonOutput"\]/typing.Any/g' "$file"
    sed -i.bak 's/"FullJsonInput"/typing.Any/g' "$file"
    sed -i.bak 's/"FullJsonOutput"/typing.Any/g' "$file"
    sed -i.bak 's/"LabelJsonInput"/typing.Any/g' "$file"
    sed -i.bak 's/"LabelJsonOutput"/typing.Any/g' "$file"
    rm -f "${file}.bak"
    echo "  Fixed: $file"
  fi
}

fix_recursive_types "./backend/types/full_json_input.py"
fix_recursive_types "./backend/types/full_json_output.py"
fix_recursive_types "./backend/types/label_json_input.py"
fix_recursive_types "./backend/types/label_json_output.py"

echo ""

# Step 10: Clean up fern directory
echo "Cleaning up fern directory..."
rm -rf ./fern
echo ""

# Step 11: Format generated code with ruff
echo "Formatting generated code with ruff..."
if command -v uvx >/dev/null 2>&1; then
  uvx ruff format ./backend/
  echo "Formatted with uvx ruff"
elif command -v ruff >/dev/null 2>&1; then
  ruff format ./backend/
  echo "Formatted with ruff"
else
  echo "Warning: ruff not found. Run 'uvx ruff format sdk/agenta/client/backend/' manually."
fi
echo ""

echo "=== SDK Generation Complete ==="
echo "Generated SDK is in: $CLIENT_DIR/backend/"
echo ""
echo "Next steps:"
echo "  1. Test imports: python -c 'from agenta.client import AgentaApi'"
echo "  2. Run SDK tests: cd sdk && poetry run pytest tests/test_fern_client.py -v"
echo "  3. Commit changes"
