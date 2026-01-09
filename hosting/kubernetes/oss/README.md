# Agenta OSS Kubernetes Deployment

Production-ready Kubernetes deployment for Agenta OSS that works on any Kubernetes distribution.

## Quick Start

### 1. Deploy Services
```bash
kubectl apply -f .
```

### 2. Install Ingress Controller
```bash
# Auto-detect cluster type and install appropriate ingress
./install-nginx-ingress.sh auto

# Or specify cluster type explicitly
./install-nginx-ingress.sh eks  # for EKS
./install-nginx-ingress.sh k3s  # for k3s
```

### 3. Access Agenta
```bash
# Get external IP
kubectl get service ingress-nginx-controller -n ingress-nginx

# Access at: http://<EXTERNAL-IP>/apps
```

## What Gets Deployed

| Service | Description | Port |
|---------|-------------|------|
| web | React frontend | 3000 |
| api | FastAPI backend | 8000 |
| worker | Celery background tasks | - |
| postgres | PostgreSQL (3 databases) | 5432 |
| redis | Cache storage | 6379 |
| cache | Session storage | 6378 |
| rabbitmq | Message broker | 5672 |
| supertokens | Authentication | 3567 |
| completion | LLM completion service | 8000 |
| chat | Chat service | 8000 |

All services run in the `agenta-oss` namespace with proper service discovery.

## Multi-Cloud Support

### Amazon EKS
```bash
./install-nginx-ingress.sh eks
```

### Google GKE
```bash
./install-nginx-ingress.sh gke
```

### Azure AKS
```bash
./install-nginx-ingress.sh aks
```

### Local k3s
```bash
./install-nginx-ingress.sh k3s
```

## Configuration

### Important: External IP Configuration

Before deploying, you MUST update the external URLs in `configmap.yml` with your actual external IP or domain:

```yaml
# In configmap.yml - Replace with your external IP/domain
AGENTA_API_URL: "http://YOUR_EXTERNAL_IP/api"
AGENTA_WEB_URL: "http://YOUR_EXTERNAL_IP"  
AGENTA_SERVICES_URL: "http://YOUR_EXTERNAL_IP/services"
DOMAIN_NAME: "http://YOUR_EXTERNAL_IP"
WEBSITE_DOMAIN_NAME: "http://YOUR_EXTERNAL_IP"
```

These URLs are used by the frontend JavaScript running in browsers to access the API.

### Complete Configuration

Key configuration is in `configmap.yml` and `secret.yml`. 

- **External URLs**: Must be accessible from browsers (set to your LoadBalancer IP/domain)
- **Internal URLs**: Used for service-to-service communication (use cluster DNS names)

## Troubleshooting

### Check Status
```bash
# All pods should be Running
kubectl get pods -n agenta-oss

# Check specific service logs
kubectl logs -n agenta-oss deployment/api
```

### Test Internal Connectivity
```bash
# Test API health
kubectl exec -n agenta-oss deployment/web -- curl http://api.agenta-oss.svc.cluster.local:8000/health
```

### Common Issues

**Pods not starting**: Check resource limits and storage availability
**External access fails**: Verify ingress controller and LoadBalancer service
**Database connection issues**: Check PostgreSQL pod logs and ConfigMap

## Scaling

```bash
kubectl scale deployment api --replicas=3 -n agenta-oss
kubectl scale deployment worker --replicas=2 -n agenta-oss
```

## Cleanup

```bash
kubectl delete namespace agenta-oss
```