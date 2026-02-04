# Langfuse Data Security & Privacy Documentation

*Source: https://langfuse.com/docs/data-security-privacy (redirects to /security)*
*Scraped: February 2026*

---

**Note:** The URL `https://langfuse.com/docs/data-security-privacy` redirects to the main security overview page at `https://langfuse.com/security`. The comprehensive security and privacy documentation has been consolidated into a single security hub.

For the complete Langfuse security and privacy documentation, please refer to `langfuse-security.md` which contains all content from:

- Security Overview
- Authentication & Authorization
- Encryption (in transit and at rest)
- Data Regions & Availability
- Technical and Organisational Measures (TOMs)
- SOC 2 Type II Compliance
- ISO 27001 Compliance
- HIPAA Compliance & BAA
- GDPR Compliance
- Managing Personal Data
- Data Processing Agreement (DPA)
- Subprocessors List

---

## Quick Reference: Key Data Privacy Features

### Data Residency Options

| Region | URL | Location |
|--------|-----|----------|
| **US** | `https://us.cloud.langfuse.com` | Oregon (AWS `us-west-2`) |
| **EU** | `https://cloud.langfuse.com` | Ireland (AWS `eu-west-1`) |
| **HIPAA** | `https://hipaa.cloud.langfuse.com` | Oregon (AWS `us-west-2`) |

### Data Protection Capabilities

1. **Data Masking** - Mask PII data in traces, observations, and scores
2. **Data Deletion** - Delete personal data upon request; add userIds to tracing data to facilitate efficient deletion
3. **Data Retention** - Control how long data is stored in Langfuse

### Privacy Commitments

- **No selling of Client Personal Data** to third parties
- **No use of Client Personal Data** to train AI models
- **No use of Client Personal Data** for advertising
- **GDPR compliant** with DPA available
- **HIPAA compliant** with BAA available for healthcare use cases

### Encryption Standards

| Service | Encryption Standard |
|---------|---------------------|
| Data in Transit | TLS 1.2 |
| Elasticache (Redis) | AES-256 |
| Aurora (Postgres) | AES-256 |
| Clickhouse | AES-256 |
| S3 / Blob Storage | AES-256 |

### Contact Information

- **Security inquiries:** security@langfuse.com
- **Privacy inquiries:** privacy@langfuse.com
- **Compliance inquiries:** compliance@langfuse.com

---

## Deployment Models

### Langfuse Cloud (Managed SaaS)
- Fully-managed, multi-tenant
- US, EU, and HIPAA data regions
- SOC 2 Type II and ISO 27001 certified
- High availability with Multi-AZ databases

### Self-hosted OSS
- MIT-licensed software
- Deploy on your own infrastructure
- Full control over data and configuration
- Can be run fully offline/air-gapped

### Self-hosted Enterprise Edition
- Commercial license
- Additional security/compliance features
- Vendor support included
- Custom deployment options

---

## Business Continuity

| Control | Details |
|---------|---------|
| High availability | Multi-AZ databases & load-balanced stateless application layer on AWS |
| Disaster recovery | Encrypted backups stored cross-region; tested at least annually |
| Status page | https://status.langfuse.com |
| RTO | 12 hours |
| RPO | 10 minutes |
