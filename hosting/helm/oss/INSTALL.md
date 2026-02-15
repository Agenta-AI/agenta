# Agenta OSS Installation Guide

This guide provides step-by-step instructions for installing Agenta OSS using Helm.

## 🚀 Quick Install

For a rapid installation with default settings:

```bash
# 1. Create namespace
kubectl create namespace agenta-oss

# 2. Install with your external IP
helm install agenta-oss . \
  --set externalUrls.api="http://YOUR_EXTERNAL_IP/api" \
  --set externalUrls.web="http://YOUR_EXTERNAL_IP" \
  --set externalUrls.services="http://YOUR_EXTERNAL_IP/services" \
  --namespace agenta-oss

# 3. Wait for deployment
kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=agenta-oss -n agenta-oss --timeout=600s

# 4. Get external IP
kubectl get ingress -n agenta-oss

# 5. Access Agenta at http://YOUR_EXTERNAL_IP
```

## 📋 Prerequisites Checklist

Before installation, ensure you have:

- [ ] Kubernetes cluster (1.19+) with sufficient resources:
  - [ ] 11+ CPU cores available
  - [ ] 16GB+ RAM available  
  - [ ] 20GB+ storage available
- [ ] Helm 3.8+ installed
- [ ] kubectl configured and connected to cluster
- [ ] Ingress controller deployed (NGINX recommended)
- [ ] StorageClass available for persistent volumes

### Verify Prerequisites

```bash
# Check Kubernetes version
kubectl version --short

# Check available resources
kubectl top nodes

# Check storage classes
kubectl get storageclass

# Check ingress controller
kubectl get pods -n ingress-nginx
```

## 🔧 Installation Steps

### Step 1: Prepare Values File

Create a custom values file:

```bash
cat > my-values.yaml << 'EOF'
# Required: External URLs (replace with your actual IP/domain)
externalUrls:
  api: "http://192.168.1.100/api"      # Replace with your IP
  web: "http://192.168.1.100"          # Replace with your IP  
  services: "http://192.168.1.100/services"  # Replace with your IP

# Required: Security keys (generate secure 32+ character strings)
secrets:
  agentaAuthKey: "your-secure-auth-key-min-32-chars"
  agentaCryptKey: "your-secure-crypt-key-min-32-chars"

# Optional: Database password
postgresql:
  auth:
    password: "secure-postgres-password"

# Optional: Reduce resources for smaller clusters
resources:
  api:
    requests:
      cpu: 200m
      memory: 256Mi
  web:
    requests:
      cpu: 200m
      memory: 256Mi
EOF
```

### Step 2: Install Dependencies

Update Helm dependencies:

```bash
helm dependency update
```

### Step 3: Validate Configuration

```bash
# Lint the chart
helm lint . -f my-values.yaml

# Dry run to validate
helm install agenta-oss . \
  -f my-values.yaml \
  --namespace agenta-oss \
  --create-namespace \
  --dry-run --debug
```

### Step 4: Install Agenta

```bash
# Install the chart
helm install agenta-oss . \
  -f my-values.yaml \
  --namespace agenta-oss \
  --create-namespace \
  --timeout 10m

# Wait for rollout
kubectl rollout status deployment/agenta-oss-api -n agenta-oss
kubectl rollout status deployment/agenta-oss-web -n agenta-oss
```

### Step 5: Verify Installation

```bash
# Check pod status
kubectl get pods -n agenta-oss

# Check services
kubectl get svc -n agenta-oss

# Check ingress
kubectl get ingress -n agenta-oss

# Test health endpoints
curl http://YOUR_IP/api/health
curl http://YOUR_IP/services/chat/health
curl http://YOUR_IP/services/completion/health
```

## 🌐 Environment-Specific Configurations

### Development Environment

```yaml
# Minimal resources for development
resources:
  api:
    requests: { cpu: 100m, memory: 128Mi }
    limits: { cpu: 500m, memory: 512Mi }
  web:
    requests: { cpu: 100m, memory: 128Mi }
    limits: { cpu: 500m, memory: 512Mi }

postgresql:
  primary:
    resources:
      requests: { cpu: 100m, memory: 256Mi }
      limits: { cpu: 500m, memory: 1Gi }

# Disable resource quotas for development
resourceQuota:
  enabled: false
```

### Staging Environment

```yaml
# Moderate resources for staging
resources:
  api:
    requests: { cpu: 300m, memory: 512Mi }
    limits: { cpu: 1000m, memory: 1Gi }
  web:
    requests: { cpu: 300m, memory: 512Mi }
    limits: { cpu: 1000m, memory: 1Gi }

# Enable basic monitoring
ingress:
  annotations:
    nginx.ingress.kubernetes.io/enable-metrics: "true"
```

### Production Environment

```yaml
# Full production resources (default)
resources:
  api:
    requests: { cpu: 500m, memory: 512Mi }
    limits: { cpu: 2000m, memory: 2Gi }
  web:
    requests: { cpu: 500m, memory: 512Mi }
    limits: { cpu: 2000m, memory: 3Gi }

# Enable resource quotas
resourceQuota:
  enabled: true

# Production ingress with TLS
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  tls:
    - secretName: agenta-tls
      hosts:
        - agenta.yourdomain.com
```

## 🔒 Security Hardening

For production deployments, consider:

```yaml
# Pod Security Standards
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 3000
  fsGroup: 2000
  seccompProfile:
    type: RuntimeDefault

# Network policies (if supported)
networkPolicies:
  enabled: true

# Resource limits enforcement
resourceQuota:
  enabled: true
  requests:
    cpu: "8"
    memory: "16Gi"
  limits:
    cpu: "20"
    memory: "32Gi"
```

## 📊 Resource Planning

### Minimum Requirements
- **CPU**: 8 cores
- **Memory**: 12GB
- **Storage**: 15GB

### Recommended Production
- **CPU**: 16 cores  
- **Memory**: 32GB
- **Storage**: 100GB

### High Availability Setup
- **CPU**: 24+ cores
- **Memory**: 48GB+
- **Storage**: 200GB+
- **Replicas**: 3+ per service

## 🚨 Common Installation Issues

### Issue: Pods Stuck in Pending
```bash
# Check resources
kubectl describe nodes
kubectl describe pod -n agenta-oss

# Solution: Increase cluster resources or reduce requests
```

### Issue: Database Connection Failed
```bash
# Check PostgreSQL logs
kubectl logs -n agenta-oss agenta-oss-postgresql-0

# Check connection string
kubectl get configmap agenta-oss-config -n agenta-oss -o yaml
```

### Issue: Ingress Not Working
```bash
# Check ingress controller
kubectl get pods -n ingress-nginx

# Check ingress resource
kubectl describe ingress -n agenta-oss
```

## 🔄 Post-Installation

### Initial Setup
1. Access web UI at your configured URL
2. Complete initial setup wizard
3. Create admin user account
4. Configure LLM providers
5. Test with sample application

### Backup Configuration
```bash
# Backup values
helm get values agenta-oss -n agenta-oss > agenta-backup-values.yaml

# Backup database
kubectl exec -n agenta-oss agenta-oss-postgresql-0 -- \
  pg_dumpall -U username > agenta-backup.sql
```

## 📞 Support

If you encounter issues:

1. Check the [Troubleshooting Guide](README.md#troubleshooting)
2. Review logs: `kubectl logs -n agenta-oss <pod-name>`
3. Visit [GitHub Issues](https://github.com/Agenta-AI/agenta/issues)
4. Join [Discord Community](https://discord.gg/agenta)

---

**Next Steps**: See [README.md](README.md) for advanced configuration options and management commands.