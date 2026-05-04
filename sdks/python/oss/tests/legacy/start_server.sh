#!/bin/bash

# Define default values
HOST="127.0.0.1"
PORT="8888"
APP=

# Function to display usage
usage() {
    echo "Usage: $0 [-h host] [-p port] [-a app]"
    echo "  -h host   Specify the FastAPI server host. Default is 127.0.0.1."
    echo "  -p port   Specify the FastAPI server port. Default is 8000."
    echo "  -a app    Specify the FastAPI app to run. Default is 'baggage'."
    exit 1
}

# Parse command-line arguments
while getopts "h:p:a:" opt; do
    case ${opt} in
        h) HOST="$OPTARG" ;;
        p) PORT="$OPTARG" ;;
        a) APP="$OPTARG" ;;
        *) usage ;;
    esac
done

if [[ -z "$APP" ]]; then
    echo "Error: Please specify the FastAPI app to run with the -a option."
    usage
fi

# Start the FastAPI server
echo "Starting FastAPI server at http://${HOST}:${PORT}..."
#uvicorn app:app --host "${HOST}" --port "${PORT}" &
cd ./apps/${APP}
python3 _main.py &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"
echo $SERVER_PID > ../../server.pid  # Save PID to a file for later use
sleep 3  # Wait for the server to start