#!/bin/bash

# Universal NGINX Ingress Controller Installation
# Works on k3s, EKS, GKE, AKS, and other Kubernetes distributions

set -euo pipefail

CLUSTER_TYPE="${1:-auto}"
DOMAIN="${2:-agenta.local}"

echo "🚀 Installing NGINX Ingress Controller for Agenta OSS"
echo "Cluster type: $CLUSTER_TYPE"
echo "Domain: $DOMAIN"
echo ""

# Function to detect cluster type
detect_cluster_type() {
    if kubectl get nodes -o jsonpath='{.items[0].metadata.labels}' | grep -q "k3s"; then
        echo "k3s"
    elif kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' | grep -q "aws"; then
        echo "eks"
    elif kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' | grep -q "gce"; then
        echo "gke"
    elif kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' | grep -q "azure"; then
        echo "aks"
    else
        echo "generic"
    fi
}

# Auto-detect if not specified
if [ "$CLUSTER_TYPE" = "auto" ]; then
    CLUSTER_TYPE=$(detect_cluster_type)
    echo "Auto-detected cluster type: $CLUSTER_TYPE"
fi

# Install NGINX Ingress Controller based on cluster type
case $CLUSTER_TYPE in
    "k3s")
        echo "📦 Installing NGINX Ingress for k3s..."
        echo "Disabling k3s built-in Traefik..."
        kubectl -n kube-system delete deployment traefik 2>/dev/null || true
        kubectl -n kube-system delete service traefik 2>/dev/null || true
        
        kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/baremetal/deploy.yaml
        
        kubectl patch deployment ingress-nginx-controller -n ingress-nginx -p '{"spec":{"template":{"spec":{"containers":[{"name":"controller","ports":[{"containerPort":80,"hostPort":80,"protocol":"TCP"},{"containerPort":443,"hostPort":443,"protocol":"TCP"}]}]}}}}'
        ;;
    "eks")
        echo "📦 Installing NGINX Ingress for EKS..."
        kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/aws/deploy.yaml
        ;;
    "gke")
        echo "📦 Installing NGINX Ingress for GKE..."
        kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/gce/deploy.yaml
        ;;
    "aks")
        echo "📦 Installing NGINX Ingress for AKS..."
        kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/cloud/deploy.yaml
        ;;
    *)
        echo "📦 Installing generic NGINX Ingress..."
        kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/cloud/deploy.yaml
        ;;
esac

echo ""
echo "⏳ Waiting for NGINX Ingress Controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=300s

echo ""
echo "🔧 Applying Agenta ingress configuration..."
kubectl apply -f nginx-ingress.yml

echo ""
echo "✅ NGINX Ingress Controller installed successfully!"
echo ""

# Get access information based on cluster type
case $CLUSTER_TYPE in
    "k3s")
        echo "🌐 Access Agenta at: http://$(hostname -I | awk '{print $1}')/apps"
        ;;
    "eks"|"gke"|"aks")
        echo "⏳ Getting LoadBalancer external IP..."
        echo "Run this command to get the external IP:"
        echo "kubectl get service ingress-nginx-controller -n ingress-nginx"
        echo ""
        echo "Then access Agenta at: http://<external-ip>/apps"
        ;;
esac

echo ""
echo "🔍 To monitor the deployment:"
echo "kubectl get pods -n agenta-oss"
echo "kubectl get ingress -n agenta-oss"
echo "kubectl get service -n ingress-nginx"