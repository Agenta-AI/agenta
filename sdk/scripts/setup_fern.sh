#!/bin/bash

# REQUIRES yq to be installed

# Helper function for error handling
handle_error() {
  echo "Error on line $1"
  exit 1
}
trap 'handle_error $LINENO' ERR

# Define the organization name
ORGANIZATION_NAME="agenta"

# Step 0: Navigate to the client folder
echo "Navigating to the client folder..."
cd core/agenta-cli/agenta/client || { echo "Client folder not found!"; exit 1; }
echo "In client folder: $(pwd)"

echo ""

# Step 1: Clean up
echo "Deleting ./fern directory..."
rm -rf ./fern
echo "Deleted ./fern directory."

echo ""

# Step 2: Install Fern
echo "Checking if Fern is installed globally..."
if ! command -v fern >/dev/null 2>&1; then
  echo "Fern is not installed globally. Please install and try again."
  exit 1
else
  echo "Fern is already installed globally."
fi

# Confirm Fern is successfully installed
if ! command -v fern >/dev/null 2>&1; then
  echo "Fern installation failed or not found. Fern is required to be installed globally before running this script."
  exit 1
fi

echo ""

# Step 3: Initialize Fern
echo "Initializing Fern with OpenAPI spec..."
read -p "Enter the OpenAPI URL (e.g., https://cloud.agenta.ai/api/openapi.json): " openapi_url
fern init --openapi "$openapi_url" --organization "$ORGANIZATION_NAME" || {
  echo "Failed to initialize Fern. Please check the OpenAPI URL and try again."
  exit 1
}

echo ""

# Step 4: Add the Fern Python SDK
echo "Adding Fern Python SDK..."
fern add fern-python-sdk

echo ""

# Step 5: Update `generators.yml` in the ./fern/ directory
echo "Updating generators.yml..."
generators_file="./fern/generators.yml"
if [ ! -f "$generators_file" ]; then
  echo "generators.yml not found in ./fern/! Please ensure initialization was successful."
  exit 1
fi

# Extract the latest version of the Python SDK
latest_version=$(grep -o 'version: [^ ]*' "$generators_file" | sed -n '2p' | cut -d' ' -f2)
if [ -z "$latest_version" ]; then
  echo "Failed to extract the latest version of fern-python-sdk. Please check generators.yml."
  exit 1
fi

# Rewrite generators.yml with only the Python SDK
cat > "$generators_file" <<EOL
api:
  path: openapi/openapi.json

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
echo "Updated generators.yml with the latest Python SDK version: $latest_version"

echo ""

# Step 6: Update the openapi.yml to resolve this: 'Score is already declared in humanEvaluations.yml'
OPENAPI_FILE="./fern/openapi/openapi.json"

# Add the Score schema to components.schemas
SCORE_SCHEMA='{
  "Score": {
    "type": "integer",
    "description": "An integer score between 1 and 5",
    "minimum": 1,
    "maximum": 5
  }
}'

# Update the JSON file
jq \
  --argjson scoreSchema "$SCORE_SCHEMA" \
  '.components.schemas.Score = $scoreSchema |
   .components.schemas.HumanEvaluationScenario.properties.score["$ref"] = "#/components/schemas/Score" |
   .components.schemas.HumanEvaluationScenarioUpdate.properties.score["$ref"] = "#/components/schemas/Score"' \
  "$OPENAPI_FILE" > temp.json && mv temp.json "$OPENAPI_FILE"

# Step 7: Generate the client code
echo "Generating the client code..."
fern generate || {
  echo "Fern generate failed. Check the configuration in generators.yml and fern.config.json."
  exit 1
}

echo ""

Step 8: Update `build_image` function
echo "Updating request_options in build_image function..."
client_file="./backend/containers/client.py"
if [ -f "$client_file" ]; then
  # Use awk to replace the target line with the new multiline logic
  awk '
  {
    if ($0 ~ /request_options=request_options,/) {
      print "        request_options=(";
      print "            {**request_options, \"timeout_in_seconds\": 600}";
      print "            if request_options";
      print "            else {\"timeout_in_seconds\": 600}";
      print "        ),";
    } else {
      print $0;
    }
  }' "$client_file" > "${client_file}.tmp" && mv "${client_file}.tmp" "$client_file"
  echo "Updated request_options in build_image function successfully."
else
  echo "$client_file not found! Please update it manually."
fi

echo ""

# Step 9: Clean up
echo "Cleaning up..."
rm -rf ./fern
echo "Deleted ./fern directory."

echo ""

echo "All steps completed successfully!"
