#!/bin/bash

# Agenta OSS Kubernetes Deployment Script
set -euo pipefail

NAMESPACE="agenta-oss"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Deploying Agenta OSS to Kubernetes..."

# Function to wait for deployment
wait_for_deployment() {
    local deployment=$1
    echo "⏳ Waiting for $deployment to be ready..."
    kubectl wait --for=condition=available deployment/$deployment -n $NAMESPACE --timeout=300s
}

# Function to wait for job completion
wait_for_job() {
    local job=$1
    echo "⏳ Waiting for job $job to complete..."
    kubectl wait --for=condition=complete job/$job -n $NAMESPACE --timeout=300s
}

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if we can connect to cluster
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    exit 1
fi

echo "✅ Connected to Kubernetes cluster"

# Deploy namespace first
echo "📦 Creating namespace..."
kubectl apply -f 00-namespace.yml

# Deploy secrets and configmaps
echo "🔐 Deploying configuration..."
kubectl apply -f secret.yml
kubectl apply -f configmap.yml
kubectl apply -f postgres-configmap.yml

# Deploy databases first (they need to be ready before app services)
echo "🗄️ Deploying databases..."
kubectl apply -f postgres-deployment.yml
kubectl apply -f redis-deployment.yml
kubectl apply -f cache-deployment.yml
kubectl apply -f rabbitmq-deployment.yml

# Wait for databases to be ready
wait_for_deployment postgres
wait_for_deployment redis  
wait_for_deployment cache
wait_for_deployment rabbitmq

# Run database migrations
echo "🔄 Running database migrations..."
kubectl apply -f alembic-job.yml
wait_for_job alembic

# Deploy authentication service
echo "🔑 Deploying authentication..."
kubectl apply -f supertokens-deployment.yml
wait_for_deployment supertokens

# Deploy application services
echo "🚀 Deploying application services..."
kubectl apply -f api-deployment.yml
kubectl apply -f web-deployment.yml
kubectl apply -f worker-deployment.yml
kubectl apply -f completion-deployment.yml
kubectl apply -f chat-deployment.yml

# Wait for core services
wait_for_deployment api
wait_for_deployment web
wait_for_deployment worker
wait_for_deployment completion
wait_for_deployment chat

# Deploy ingress last (nginx-ingress.yml replaces ingress.yml)
echo "🌐 Deploying ingress..."
kubectl apply -f nginx-ingress.yml

echo ""
echo "✅ Agenta OSS deployment completed!"
echo ""
echo "📊 Deployment Status:"
kubectl get pods -n $NAMESPACE

echo ""
echo "🌐 Services:"
kubectl get svc -n $NAMESPACE

echo ""
echo "🔗 Ingress:"
kubectl get ingress -n $NAMESPACE

echo ""
echo "🎉 Agenta OSS is now deployed!"
echo ""
echo "📝 Next steps:"
echo "1. Install ingress controller: ./install-nginx-ingress.sh auto"
echo "2. Get external IP: kubectl get service ingress-nginx-controller -n ingress-nginx"
echo "3. Access Agenta at: http://<external-ip>/apps"