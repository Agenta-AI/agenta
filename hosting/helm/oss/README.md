# Agenta OSS Helm Chart

This Helm chart deploys [Agenta OSS](https://github.com/Agenta-AI/agenta), a comprehensive LLMOps platform for managing, versioning, and deploying LLM applications.

## 🚀 Quick Start

```bash
# Add the Helm repository (if available)
helm repo add agenta https://charts.agenta.ai
helm repo update

# Install Agenta OSS
helm install agenta-oss agenta/agenta-oss \
  --set externalUrls.api="http://YOUR_EXTERNAL_IP/api" \
  --set externalUrls.web="http://YOUR_EXTERNAL_IP" \
  --set externalUrls.services="http://YOUR_EXTERNAL_IP/services" \
  --create-namespace \
  --namespace agenta-oss
```

## 📋 Prerequisites

- Kubernetes 1.19+ cluster
- Helm 3.8+
- 8+ CPU cores and 16GB+ RAM available in cluster
- StorageClass for persistent volumes
- Ingress controller (NGINX recommended)

### Minimum Infrastructure Requirements

| Service | CPU | Memory | Storage |
|---------|-----|--------|---------|
| API Service | 2 CPU | 2GB | - |
| Web Frontend (Next.js) | 2 CPU | 3GB | - |
| Chat Service | 1 CPU | 1GB | - |
| Completion Service | 1 CPU | 1GB | - |
| Worker Service | 1 CPU | 1GB | - |
| PostgreSQL | 2 CPU | 4GB | 10GB |
| Redis | 1 CPU | 1.5GB | 1GB |
| RabbitMQ | 1 CPU | 1GB | 1GB |
| **Total** | **11 CPU** | **15.5GB** | **12GB** |

## 📦 Installation

### 1. Local Installation (from source)

```bash
# Clone the repository
git clone https://github.com/Agenta-AI/agenta.git
cd agenta/hosting/helm/oss

# Create values file
cp values.yaml my-values.yaml

# Edit configuration (required)
nano my-values.yaml

# Install the chart
helm install agenta-oss . \
  -f my-values.yaml \
  --create-namespace \
  --namespace agenta-oss
```

### 2. Production Installation

```bash
# Create production values
cat > production-values.yaml << EOF
externalUrls:
  api: "https://api.yourdomain.com"
  web: "https://yourdomain.com"
  services: "https://services.yourdomain.com"

secrets:
  agentaAuthKey: "your-secure-auth-key-32-chars"
  agentaCryptKey: "your-secure-crypt-key-32-chars"

postgresql:
  auth:
    password: "secure-postgres-password"
    
ingress:
  enabled: true
  className: "nginx"
  hosts:
    - host: yourdomain.com
      paths:
        - path: /
          pathType: Prefix
          service: agenta-oss-web
          port: 3000
        - path: /api
          pathType: Prefix  
          service: agenta-oss-api
          port: 8000
        - path: /services
          pathType: Prefix
          service: agenta-oss-services
          port: 80
  tls:
    - secretName: agenta-tls
      hosts:
        - yourdomain.com
EOF

# Install with production configuration
helm install agenta-oss agenta/agenta-oss \
  -f production-values.yaml \
  --namespace agenta-oss \
  --create-namespace
```

### 3. Development Installation

```bash
# Quick development setup with minimal resources
helm install agenta-oss . \
  --set resources.api.requests.cpu=100m \
  --set resources.api.requests.memory=256Mi \
  --set resources.web.requests.cpu=100m \
  --set resources.web.requests.memory=256Mi \
  --set postgresql.primary.resources.requests.cpu=100m \
  --set postgresql.primary.resources.requests.memory=256Mi \
  --set externalUrls.api="http://localhost:8000/api" \
  --set externalUrls.web="http://localhost:3000" \
  --set externalUrls.services="http://localhost:8080/services" \
  --namespace agenta-dev \
  --create-namespace
```

## ⚙️ Configuration

### Required Configuration

The following values **must** be configured before installation:

```yaml
# External URLs - Update with your actual domain or IP
externalUrls:
  api: "https://api.yourdomain.com"      # External API endpoint
  web: "https://yourdomain.com"          # Web frontend URL  
  services: "https://services.yourdomain.com"  # Services endpoint

# Security keys - Generate secure 32+ character strings
secrets:
  agentaAuthKey: "your-secure-auth-key-here"
  agentaCryptKey: "your-secure-crypt-key-here"
```

### Optional Configuration

<details>
<summary>📊 Resource Configuration</summary>

```yaml
resources:
  api:
    limits:
      cpu: 2000m
      memory: 2Gi
    requests:
      cpu: 500m
      memory: 512Mi
  web:
    limits:
      cpu: 2000m      # Next.js needs more resources
      memory: 3Gi
    requests:
      cpu: 500m
      memory: 512Mi
```
</details>

<details>
<summary>🗄️ Database Configuration</summary>

```yaml
postgresql:
  enabled: true
  auth:
    username: "agenta"
    password: "your-secure-password"
    database: "agenta_oss_core"
  primary:
    persistence:
      enabled: true
      size: 20Gi
    resources:
      limits:
        cpu: 2000m
        memory: 4Gi
```
</details>

<details>
<summary>🔒 Security Configuration</summary>

```yaml
# Pod Security Standards
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 3000
  fsGroup: 2000
  seccompProfile:
    type: RuntimeDefault

# Resource Quotas  
resourceQuota:
  enabled: true
  requests:
    cpu: "8"
    memory: "16Gi"
  limits:
    cpu: "20" 
    memory: "32Gi"
```
</details>

<details>
<summary>🌐 Ingress Configuration</summary>

```yaml
ingress:
  enabled: true
  className: "nginx"
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
  hosts:
    - host: yourdomain.com
      paths:
        - path: /
          pathType: Prefix
          service: agenta-oss-web
          port: 3000
  tls:
    - secretName: agenta-tls
      hosts:
        - yourdomain.com
```
</details>

## 🔧 Management

### Upgrading

```bash
# Upgrade to latest version
helm upgrade agenta-oss agenta/agenta-oss \
  -f my-values.yaml \
  --namespace agenta-oss

# Upgrade with new values
helm upgrade agenta-oss . \
  --set externalUrls.api="https://new-api.domain.com" \
  --namespace agenta-oss
```

### Monitoring

```bash
# Check deployment status
kubectl get pods -n agenta-oss

# View service health
curl http://YOUR_EXTERNAL_IP/api/health
curl http://YOUR_EXTERNAL_IP/services/chat/health
curl http://YOUR_EXTERNAL_IP/services/completion/health

# Check resource usage
kubectl describe resourcequota -n agenta-oss

# View logs
kubectl logs -n agenta-oss deployment/agenta-oss-api
kubectl logs -n agenta-oss deployment/agenta-oss-web
```

### Backup and Restore

```bash
# Backup PostgreSQL data
kubectl exec -n agenta-oss agenta-oss-postgresql-0 -- \
  pg_dump -U username agenta_oss_core > backup.sql

# Create persistent volume snapshots (cloud-specific)
kubectl get pv -l app.kubernetes.io/instance=agenta-oss
```

### Scaling

```bash
# Scale API replicas
helm upgrade agenta-oss . \
  --set replicaCount.api=3 \
  --namespace agenta-oss

# Scale resources
helm upgrade agenta-oss . \
  --set resources.api.requests.cpu=1000m \
  --set resources.api.requests.memory=1Gi \
  --namespace agenta-oss
```

## 🧪 Testing

### Health Checks

```bash
# Run Helm tests
helm test agenta-oss -n agenta-oss

# Manual health checks
curl -f http://YOUR_EXTERNAL_IP/api/health || echo "API unhealthy"
curl -f http://YOUR_EXTERNAL_IP/services/chat/health || echo "Chat unhealthy"
curl -f http://YOUR_EXTERNAL_IP/services/completion/health || echo "Completion unhealthy"
```

### Validation

```bash
# Validate chart templates
helm lint .

# Dry run installation
helm install agenta-oss . \
  -f my-values.yaml \
  --dry-run \
  --debug

# Template validation
helm template agenta-oss . \
  -f my-values.yaml | kubectl apply --dry-run=client -f -
```

## 📄 Values Reference

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace` | Target namespace | `agenta-oss` |
| `externalUrls.api` | External API URL | `""` |
| `externalUrls.web` | External web URL | `""` |
| `externalUrls.services` | External services URL | `""` |
| `secrets.agentaAuthKey` | Authentication key | `""` |
| `secrets.agentaCryptKey` | Encryption key | `""` |
| `resources.api.limits.cpu` | API CPU limit | `2000m` |
| `resources.api.limits.memory` | API memory limit | `2Gi` |
| `resources.web.limits.cpu` | Web CPU limit | `2000m` |
| `resources.web.limits.memory` | Web memory limit | `3Gi` |
| `postgresql.enabled` | Enable PostgreSQL | `true` |
| `redis.enabled` | Enable Redis | `true` |
| `rabbitmq.enabled` | Enable RabbitMQ | `true` |
| `ingress.enabled` | Enable ingress | `true` |
| `resourceQuota.enabled` | Enable resource quotas | `true` |

For complete values reference, see [values.yaml](values.yaml).

