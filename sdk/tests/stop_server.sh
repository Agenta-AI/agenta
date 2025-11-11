#!/bin/bash

# Function to display usage
usage() {
    echo "Usage: $0"
    echo "Stops the FastAPI server started with start_server.sh."
    exit 1
}

# Check if the PID file exists
if [[ ! -f server.pid ]]; then
    echo "Error: PID file 'server.pid' not found. Is the server running?"
    exit 1
fi

# Read the PID from the file
SERVER_PID=$(cat server.pid)

# Validate that the PID is a running process
if ps -p "$SERVER_PID" > /dev/null 2>&1; then
    echo "Stopping FastAPI server (PID: $SERVER_PID)..."
    kill "$SERVER_PID"  # Send the termination signal

    # Wait for the process to terminate
    sleep 2

    # Double-check if the process is still running
    if ps -p "$SERVER_PID" > /dev/null 2>&1; then
        echo "Error: Failed to stop the server. Attempting to force stop..."
        kill -9 "$SERVER_PID"  # Force kill the process
        sleep 1

        if ps -p "$SERVER_PID" > /dev/null 2>&1; then
            echo "Error: Unable to stop the server process even with force. Manual intervention required."
            exit 1
        fi
    fi

    echo "FastAPI server stopped successfully."
    rm -f server.pid  # Remove the PID file
else
    echo "Error: No process found with PID $SERVER_PID. Removing stale PID file."
    rm -f server.pid
    exit 1
fi