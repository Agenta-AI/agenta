#!/bin/bash

# Define default values for the server
HOST="127.0.0.1"
PORT="8888"
TEST_TARGET="specs/*"
PYTEST_OPTIONS=""
MARKERS=""
APP=""

# Function to display usage
usage() {
    echo "Usage: $0 [-h host] [-p port] [-t test_target] [-o pytest_options] [-m markers] [-a app] [-k key]"
    echo "  -h host           Specify the FastAPI server host. Default is 127.0.0.1."
    echo "  -p port           Specify the FastAPI server port. Default is 8000."
    echo "  -t test_target    Specify the pytest test target to run. Default is 'specs'."
    echo "  -o pytest_options Pass additional options to pytest."
    echo "  -m markers        Specify marker expressions (e.g., 'smoke or integration')."
    echo "  -a app            Specify the FastAPI app to run."
    echo "  -k key            Specify the API key."
    exit 1
}

# Parse command-line arguments
while getopts "h:p:t:o:m:a:k:" opt; do
    case ${opt} in
        h) HOST="$OPTARG" ;;
        p) PORT="$OPTARG" ;;
        t) TEST_TARGET="$OPTARG" ;;
        o) PYTEST_OPTIONS="$OPTARG" ;;
        m) MARKERS="$OPTARG" ;;
        a) APP="$OPTARG" ;;
        k) API_KEY="$OPTARG" ;;
        *) usage ;;
    esac
done

if [[ -z "$APP" ]]; then
    echo "Error: Please specify the FastAPI app to run with the -a option."
    usage
fi

# Start the FastAPI server
./start_server.sh -h "$HOST" -p "$PORT" -a "$APP"

# Export the base URL as an environment variable
export BASE_URL="http://${HOST}:${PORT}"

# Export the API key as an environment variable
export API_KEY="$API_KEY"

# Run pytest tests with markers
./run_pytest.sh -t "$TEST_TARGET" -o "$PYTEST_OPTIONS" -m "$MARKERS" -a "$APP"

# Stop the FastAPI server
./stop_server.sh