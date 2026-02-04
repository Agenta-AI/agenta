# Research Findings

## Competitor Analysis

### LangSmith (LangChain)
- **Compliance**: SOC 2 Type 2, HIPAA compliant
- **Regions**: US (GCP us-central1 Iowa), EU (GCP europe-west4 Netherlands)
- **Trust Center**: trust.langchain.com (Vanta-powered)
- **Strengths**: Deep technical architecture transparency, detailed rate limits, IP allowlisting
- **DPA**: Contact required

### Braintrust
- **Compliance**: SOC 2 Type II, HIPAA (BAA available)
- **Encryption**: AES-256 with unique 256-bit keys and nonces
- **Trust Center**: trust.braintrust.dev (Vanta-powered)
- **Strengths**: Hybrid deployment model, code execution security details
- **RBAC**: Owners, Engineers, Viewers + custom groups

### Langfuse (Best-in-class docs)
- **Compliance**: SOC 2 Type II, ISO 27001, HIPAA (dedicated region)
- **Encryption**: TLS 1.2 in transit, AES-256 at rest
- **Regions**: US (Oregon), EU (Ireland), HIPAA (Oregon)
- **Strengths**: 
  - Full DPA and BAA published online
  - Detailed sub-processor list by region
  - RTO/RPO published (12h/10min)
  - TOMs document for GDPR Article 32
  - 20+ page security documentation section
- **Structure**: Security (12 pages), Compliance (5), Privacy (5), Legal (3)

### Key Takeaways
1. All competitors have Vanta/Sprinto-powered Trust Centers
2. Langfuse is most transparent (full legal docs online)
3. All emphasize SOC 2 Type II
4. Regional data residency is table stakes
5. Publishing RTO/RPO builds trust

## Agenta Technical Findings

### Encryption

**At Rest** (from `api/oss/src/dbs/postgres/secrets/custom_fields.py`):
```python
# PostgreSQL PGP symmetric encryption
func.pgp_sym_encrypt(bindvalue, data_encryption_key)
func.pgp_sym_decrypt(col, data_encryption_key)
```
- Uses PostgreSQL's `pgcrypto` extension
- PGP symmetric encryption (AES-256 based)
- Key managed via environment variable `AGENTA_CRYPT_KEY`

**In Transit** (from `agenta_cloud/hosting/docker-compose/`):
```yaml
# Traefik TLS configuration
- "traefik.http.routers.web.tls=true"
- "traefik.http.routers.web.tls.certresolver=myResolver"
```
- TLS via Traefik reverse proxy
- Let's Encrypt for certificate management
- HTTPS enforced

### RBAC Model

**Roles** (from `api/ee/src/models/shared_models.py`):

| Role | Description |
|------|-------------|
| `OWNER` | Full workspace management, including members |
| `VIEWER` | View-only access |
| `EDITOR` | Edit content, cannot manage members/roles |
| `EVALUATOR` | View + create/run evaluations |
| `WORKSPACE_ADMIN` | Manage settings/members, cannot delete workspace |
| `DEPLOYMENT_MANAGER` | View + deploy applications |

**Permission Categories** (50+ permissions):
- Applications: view, edit, create variants, delete variants
- Secrets: view, edit
- Tracing/Spans: view, edit
- Folders: view, edit
- API Keys: view, edit
- Deployments: view, edit, create
- Testsets: view, edit, create, delete
- Evaluations: view, edit, create, delete, run
- Workflows: view, edit, run
- Evaluators: view, edit
- Queries: view, edit
- Workspace: view, edit, create, delete, modify roles, add users
- Organization: edit, delete, add users
- Billing: view, edit

### Data Regions

| Region | URL | AWS Region | Backup Region | Location |
|--------|-----|------------|---------------|----------|
| EU | eu.cloud.agenta.ai | `eu-central-1` | `eu-west-1` | Frankfurt (primary), Ireland (backup) |
| US | us.cloud.agenta.ai | `us-east-2` | `us-west-2` | Ohio (primary), Oregon (backup) |
| Enterprise | Custom | Custom | Custom | Dedicated instances |

Selection happens at signup.

**Source**: `agenta-infra/environments/workloads/cloud/{eu,us}/locals.tf`

### Infrastructure Details (from Terraform)

**Database (Aurora PostgreSQL):**
- Instance class: `db.r8g.large`
- Backup retention: 7 days
- Backup window: 03:30-05:30 UTC
- Deletion protection: Enabled
- IAM database authentication: Enabled

**Compute:**
- Instance class: `r7a.large`
- Disk size: 200 GB
- Multi-AZ: 2 availability zones (a, b)

**Networking:**
- VPC Flow Logs: Enabled (30-day retention)
- NAT Gateway: Per availability zone (HA)
- Load Balancer: ALB with deletion protection

**Logging:**
- CloudWatch log retention: 90 days

**Encryption:**
- S3: AES-256 server-side encryption
- EBS: Encrypted volumes
- ALB SSL Policy: `ELBSecurityPolicy-2016-08`

**Source**: `agenta-infra/environments/workloads/cloud/{eu,us}/multi/terraform.tfvars`

### External Resources

- **Trust Center**: https://trustcenter.agenta.ai/ (Sprinto-powered)
  - SOC 2 badge
  - Controls: Product, Data, Network, App, Endpoint, Corporate security
  - Resources: 33+ policies
- **Status Page**: https://agenta.hyperping.app/
- **Terms of Service**: https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7
- **Privacy Policy**: https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59

## Recommended Documentation Structure

Based on competitor analysis and Agenta's features:

```
Administration/
├── Security/
│   ├── overview.mdx         # Encryption, architecture, Trust Center link
│   ├── data-regions.mdx     # EU, US, enterprise options
│   ├── compliance.mdx       # SOC 2, link to Trust Center
│   └── privacy.mdx          # Data handling, future DPA
│
└── Access Control/
    ├── organizations.mdx    # Workspaces, members, multi-org
    ├── sso.mdx              # Enterprise SSO (OIDC)
    ├── rbac.mdx             # 6 roles, permissions matrix
    └── domain-verification.mdx
```

## What to Emphasize

1. **SOC 2 Type 2** - prominently display
2. **Data residency** - EU/US choice at signup
3. **Encryption** - AES-256 at rest, TLS in transit
4. **RBAC granularity** - 6 roles, 50+ permissions
5. **Enterprise flexibility** - dedicated instances available
6. **Trust Center** - link for detailed controls

## What to Defer

1. Sub-processor list (not finalized)
2. DPA (not available)
3. RTO/RPO numbers (not published)
4. HIPAA (not applicable)
5. Provider-specific SSO guides (future work)
