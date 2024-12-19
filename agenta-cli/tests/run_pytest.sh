#!/bin/bash

# Define default values
TEST_TARGET="specs/*"
PYTEST_OPTIONS=""
MARKERS=""
APP=""

# Function to display usage
usage() {
    echo "Usage: $0 [-t test_target] [-o pytest_options] [-m markers] [-a app]"
    echo "  -t test_target    Specify the pytest test target to run. Default is 'specs/'."
    echo "  -o pytest_options Pass additional options to pytest."
    echo "  -m markers        Specify marker expressions (e.g., 'smoke or integration')."
    echo "  -a app            Specify the FastAPI app to run."
    exit 1
}

# Parse command-line arguments
while getopts "t:o:m:a:" opt; do
    case ${opt} in
        t) TEST_TARGET="$OPTARG" ;;
        o) PYTEST_OPTIONS="$OPTARG" ;;
        m) MARKERS="$OPTARG" ;;
        a) APP="$OPTARG" ;;
        *) usage ;;
    esac
done

if [[ -z "$APP" ]]; then
    echo "Error: Please specify the FastAPI app to run with the -a option."
    usage
fi

TEST_TARGET="./apps/${APP}/${TEST_TARGET}"

# Build marker expression if markers are specified
if [[ -n "$MARKERS" ]]; then
    MARKER_EXPR="-m \"$MARKERS\""
fi

# Run pytest with the specified options
echo "Running pytest tests in $TEST_TARGET with options: $PYTEST_OPTIONS $MARKER_EXPR"
eval pytest "$TEST_TARGET" $PYTEST_OPTIONS $MARKER_EXPR