#!/bin/bash

# Agenta OSS Kubernetes Validation Script
set -euo pipefail

NAMESPACE="agenta-oss"

echo "🔍 Validating Agenta OSS Kubernetes deployment..."

# Check if namespace exists
if ! kubectl get namespace $NAMESPACE &> /dev/null; then
    echo "❌ Namespace $NAMESPACE does not exist"
    exit 1
fi

echo "✅ Namespace $NAMESPACE exists"

# Check all expected deployments
EXPECTED_DEPLOYMENTS=("api" "web" "worker" "postgres" "redis" "cache" "rabbitmq" "supertokens" "completion" "chat")

echo "🔍 Checking deployments..."
for deployment in "${EXPECTED_DEPLOYMENTS[@]}"; do
    if kubectl get deployment $deployment -n $NAMESPACE &> /dev/null; then
        STATUS=$(kubectl get deployment $deployment -n $NAMESPACE -o jsonpath='{.status.conditions[?(@.type=="Available")].status}')
        if [ "$STATUS" = "True" ]; then
            echo "✅ $deployment: Ready"
        else
            echo "⚠️ $deployment: Not ready"
        fi
    else
        echo "❌ $deployment: Not found"
    fi
done

# Check services
echo ""
echo "🔍 Checking services..."
EXPECTED_SERVICES=("api" "web" "postgres" "redis" "cache" "rabbitmq" "supertokens" "completion" "chat")

for service in "${EXPECTED_SERVICES[@]}"; do
    if kubectl get service $service -n $NAMESPACE &> /dev/null; then
        echo "✅ $service: Service exists"
    else
        echo "❌ $service: Service not found"
    fi
done

# Check ingress
echo ""
echo "🔍 Checking ingress..."
if kubectl get ingress -n $NAMESPACE &> /dev/null; then
    echo "✅ Ingress resources exist"
    kubectl get ingress -n $NAMESPACE
else
    echo "❌ No ingress resources found"
fi

# Check pods
echo ""
echo "📊 Pod status:"
kubectl get pods -n $NAMESPACE

# Check for any failed pods
FAILED_PODS=$(kubectl get pods -n $NAMESPACE --field-selector=status.phase=Failed --no-headers 2>/dev/null | wc -l)
if [ "$FAILED_PODS" -gt 0 ]; then
    echo ""
    echo "⚠️ Warning: $FAILED_PODS failed pods found"
    kubectl get pods -n $NAMESPACE --field-selector=status.phase=Failed
fi

# Check persistent volumes
echo ""
echo "💾 Persistent Volume Claims:"
kubectl get pvc -n $NAMESPACE

echo ""
echo "🎯 Validation complete!"

# Test connectivity
echo ""
echo "🔗 Testing internal connectivity..."

# Test if API pod can reach postgres
API_POD=$(kubectl get pods -n $NAMESPACE -l app=api --no-headers -o custom-columns=":metadata.name" | head -1)
if [ -n "$API_POD" ]; then
    echo "Testing API -> Postgres connection..."
    if kubectl exec -n $NAMESPACE $API_POD -- nc -z postgres.agenta-oss.svc.cluster.local 5432; then
        echo "✅ API can reach Postgres"
    else
        echo "❌ API cannot reach Postgres"
    fi
else
    echo "⚠️ No API pod found for connectivity test"
fi