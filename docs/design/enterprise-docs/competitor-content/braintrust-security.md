# Braintrust Security Documentation

*Source: https://www.braintrust.dev/docs/security*
*Scraped: February 2026*

---

## Overview

Braintrust implements industry-leading security practices and maintains compliance with key standards to protect your data and ensure the highest levels of security for the platform.

**Trust Center:** The [Trust center](https://trust.braintrust.dev/) is the central resource for information about Braintrust's security practices, certifications, and policies. It provides up-to-date details for customers and partners.

---

## Deployment Options

In addition to the managed cloud service, Braintrust offers a **hybrid deployment model**. This allows customers to keep data secure within their own environment while taking advantage of Braintrust's newest UI and platform features.

---

## Authentication

The Braintrust UI supports end-user authentication through:

### Enterprise Identity Providers
- Google
- Okta
- Microsoft

### SSO/SAML Integration
- Okta Workforce
- Microsoft Entra ID
- Google Workspace

### OpenID Connect (OIDC)
- Custom providers supported

Users receive credentials directly in their browser that securely communicate with your data plane.

### API Key Security

For programmatic access:
- API keys are displayed only once upon creation
- Keys are stored as **cryptographic hashes, never in plaintext**
- Each key inherits the user's permissions
- Keys can be scoped to specific projects

### API Key Best Practices
- Rotate keys periodically
- Revoke compromised keys immediately
- Store keys in environment variables or secret management systems (never in code)
- Apply principle of least privilege
- Monitor API key usage through activity logs

### MCP Authentication

For Model Context Protocol (MCP) servers:
- Authentication uses **OAuth 2.0 with PKCE** (Proof Key for Code Exchange)
- MCP clients authenticate via standard OAuth flow
- Access tokens with refresh capabilities for secure, long-lived sessions
- Tokens inherit your user account permissions
- Provides access only to resources you can normally access

---

## Authorization

Braintrust uses **role-based access control (RBAC)** with:

### Built-in Permission Groups
- Owners
- Engineers
- Viewers

### Custom Groups
- Support for custom groups with fine-grained permissions

### Permission Levels
- Organization level
- Project level
- Individual object level (experiment, dataset, prompt)

This enables:
- Project-level isolation
- Object-level access control for sensitive resources

---

## Data Encryption

### Encryption at Rest
- All data is encrypted at rest

### Encryption in Transit
- All data is encrypted in transit

### Secrets Encryption
- LLM provider API keys and secrets are encrypted using **AES-256**
- Unique 256-bit keys and nonces for each secret

### Self-hosted Encryption Keys
For self-hosted deployments, you control encryption keys through your cloud provider's key management system:
- AWS KMS
- Google Cloud KMS
- Azure Key Vault

---

## Network Security

### Data Plane Isolation
- The data plane runs in an isolated VPC with no access to internal infrastructure (hosted)
- Or in your own VPC (self-hosted)

### Code Execution Security
- Custom code functions can execute in quarantined VPCs on AWS deployments

### Self-hosted Network Options
- Firewall deployment support
- VPN deployment for additional security

### Data Flow Architecture
- SDKs and browser UI communicate directly with your data plane via CORS
- **No customer data flows through Braintrust's control plane**

### Private Network Access (Self-hosted)
- Access to internal LLM models
- Access to proprietary tools
- Access to private databases

---

## Code Execution

Braintrust provides several function types to enable features like Python and TypeScript scorers, hosted tools, and replay-able eval functions.

### Function Types

| Type | Description |
|------|-------------|
| **Prompts** | Mustache or Nunjucks-templated text messages filled dynamically |
| **Inline code** | TypeScript or Python code snippets |
| **Bundled code** | Packaged TypeScript or Python applications |
| **HTTP endpoints** | External functions called over HTTP |
| **Global functions** | Pre-installed functions from the open source autoevals library |

### Security Models by Function Type

#### Prompts, HTTP Endpoints, Global Functions
- **Prompts:** Template expansions (straightforward security model)
- **HTTP endpoints:** Communicate with your external services
- **Global functions:** Run pre-vetted code from the autoevals library

#### Inline and Bundled Code

**For Braintrust-hosted deployments and self-hosted deployments on AWS:**
- Run in an isolated VPC specifically for function execution
- Environment has no access to your internal infrastructure (databases, application servers)
- Can make outbound internet requests (for API calls, package downloads)
- Organization-level separation when multiple orgs share the same stack
- Functions run in ephemeral AWS Lambda environments

**For self-hosted deployments on GCP and Azure:**
- Custom code runs in the same process as the data plane without isolation

---

## Data Residency and Retention

### Self-hosted Data Residency
- All sensitive data (experiment logs, traces, datasets, prompts) kept within your cloud account and region
- Enables regulatory compliance

### Automated Retention Policies
Configure automated retention policies to delete data after specified periods:
- Example: 7 days for development
- Example: 90 days for production
- Example: 180 days for experiments

### Soft Delete (Hybrid Deployments v1.1.21+)
- Data is soft-deleted with a 24-hour grace period before permanent removal

### Data Export Options

**Export to S3:**
- Periodic export capability
- JSON Lines or Parquet formats

**On-demand Export via API:**
- JSON or Parquet formats
- Export entire projects or organizations

---

## Compliance

### SOC 2 Type II

Braintrust is **SOC 2 Type II compliant**.

- This independent audit confirms that controls related to security, availability, and confidentiality are operating effectively over time
- Associated documentation and reports are available on the [Trust Center](https://trust.braintrust.dev/) after signing a mutual NDA

### HIPAA

Braintrust supports **HIPAA compliance requirements** and maintains the necessary:
- Administrative safeguards
- Physical safeguards
- Technical safeguards

For handling protected health information (PHI).

**Business Associate Agreements (BAAs):**
- Braintrust can execute BAAs for organizations subject to HIPAA regulations

To discuss specific HIPAA compliance needs, contact Braintrust.

### GDPR

For GDPR compliance requirements:
- Braintrust can execute **Data Processing Agreements (DPAs)** to satisfy certain data processing obligations

**For full GDPR compliance:**
- Organizations should use Braintrust's hybrid deployment model with self-hosting in the EU

To discuss specific GDPR requirements, contact Braintrust.

---

## Summary Comparison Table

| Feature | Braintrust Cloud | Braintrust Self-hosted |
|---------|------------------|------------------------|
| **Data Plane** | Isolated VPC | Your own VPC |
| **Encryption at Rest** | Yes | Yes (your KMS) |
| **Encryption in Transit** | Yes | Yes |
| **RBAC** | Yes | Yes |
| **SSO/SAML** | Yes | Yes |
| **SOC 2 Type II** | Yes | N/A (your responsibility) |
| **HIPAA BAA** | Available | Available |
| **GDPR DPA** | Available | Available |
| **Data Residency** | Braintrust infrastructure | Your cloud region |
| **Private Network Access** | No | Yes |
| **Code Isolation** | AWS Lambda VPC | AWS Lambda VPC (AWS only) |

---

## Contact

To discuss security requirements: [Contact Braintrust](https://www.braintrust.dev/contact)

Trust Center: https://trust.braintrust.dev/
