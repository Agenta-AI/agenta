#!/bin/bash

echo "🚀 Starting Agenta OSS access via port forwarding..."
echo ""

# Kill any existing port forwards
pkill -f "kubectl port-forward.*agenta-oss" 2>/dev/null || true

# Start port forwarding in background
echo "Setting up port forwarding..."
kubectl port-forward -n agenta-oss svc/web 3000:3000 > /dev/null 2>&1 &
kubectl port-forward -n agenta-oss svc/api 8000:8000 > /dev/null 2>&1 &

# Wait a moment for port forwards to establish
sleep 3

echo "✅ Agenta OSS is now accessible at:"
echo ""
echo "🌐 Frontend: http://localhost:3000"
echo "🔧 API:      http://localhost:8000"
echo "📊 API Health: http://localhost:8000/health"
echo ""
echo "💡 Note: Keep this terminal open. Press Ctrl+C to stop port forwarding."
echo ""

# Test the connections
echo "🔍 Testing connections..."
if curl -s http://localhost:8000/health | grep -q "ok"; then
    echo "✅ API is responding"
else
    echo "⚠️ API not responding yet, may need a moment to start"
fi

# Keep the script running
trap 'echo "Stopping port forwarding..."; pkill -f "kubectl port-forward.*agenta-oss"; exit' INT
echo "Port forwarding active. Press Ctrl+C to stop."
while true; do
    sleep 10
done