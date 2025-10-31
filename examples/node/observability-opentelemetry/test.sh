#!/bin/bash
# Test script for OpenTelemetry example

# Check if required environment variables are set
if [ -z "$AGENTA_API_KEY" ]; then
    echo "❌ Error: AGENTA_API_KEY is not set"
    echo "   Set it with: export AGENTA_API_KEY='your_key_here'"
    exit 1
fi

if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Error: OPENAI_API_KEY is not set"
    echo "   Set it with: export OPENAI_API_KEY='your_key_here'"
    exit 1
fi

# Set default AGENTA_HOST if not provided
if [ -z "$AGENTA_HOST" ]; then
    export AGENTA_HOST="https://cloud.staging.agenta.ai"
    echo "ℹ️  Using default AGENTA_HOST: $AGENTA_HOST"
fi

echo "✅ Environment variables configured"
echo ""
echo "🚀 Running example..."
echo ""

npm start

