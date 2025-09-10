# Changelog

All notable changes to the Agenta OSS Helm chart will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial Helm chart implementation
- Comprehensive documentation and examples
- Production-ready resource specifications

## [0.1.0] - 2025-08-04

### Added
- **Core Application Services**
  - API service deployment with FastAPI backend
  - Web frontend deployment with Next.js
  - Chat service for LLM chat interactions
  - Completion service for LLM completions  
  - Worker service for background task processing
  - SuperTokens authentication service

- **Infrastructure Dependencies**
  - PostgreSQL database with multi-database support (core, tracing, supertokens)
  - Redis cache with master-replica configuration
  - RabbitMQ message broker for task queues
  - NGINX Ingress configuration with path-based routing

- **Security Features**
  - Pod Security Standards implementation
  - SecurityContext with non-root containers
  - Capability dropping (ALL capabilities removed)
  - seccomp profiles (RuntimeDefault)
  - Resource quotas and limits enforcement

- **Resource Management**
  - Production-ready resource specifications
  - API: 2 CPU / 2GB (database operations)
  - Web: 2 CPU / 3GB (Next.js SSR + compilation)
  - Chat: 1 CPU / 1GB (LLM interactions)
  - Completion: 1 CPU / 1GB (LLM completions)
  - Worker: 1 CPU / 1GB (background processing)
  - PostgreSQL: 2 CPU / 4GB (database workloads)
  - Redis: 1 CPU / 1.5GB (caching operations)
  - RabbitMQ: 1 CPU / 1GB (message queuing)
  - Namespace-level ResourceQuota implementation

- **Configuration Management**
  - Centralized ConfigMap for application settings
  - Separate service templates for better organization
  - Comprehensive values.yaml with detailed documentation
  - JSON Schema validation for input validation
  - External URL configuration for multi-environment support

- **Networking**
  - Ingress configuration with NGINX controller support
  - Service discovery with proper DNS naming
  - Internal service communication configuration
  - Path-based routing for web, API, and services

- **Health and Monitoring**
  - Health check endpoints for all services
  - Liveness and readiness probes
  - Resource usage monitoring via ResourceQuota
  - Comprehensive logging configuration

- **Development Experience**
  - Helm template linting and validation
  - Comprehensive README with installation guides
  - Troubleshooting documentation
  - Multiple installation scenarios (dev, staging, production)

### Technical Details
- **Chart Version**: 0.1.0
- **App Version**: 0.50.3
- **Kubernetes Compatibility**: 1.19+
- **Helm Version**: 3.8+
- **Dependencies**:
  - postgresql: 15.5.6 (Bitnami)
  - redis: 19.6.4 (Bitnami)  
  - rabbitmq: 14.6.6 (Bitnami)

### Dependencies
```yaml
dependencies:
  - name: postgresql
    version: "15.5.6"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled
  - name: redis
    version: "19.6.4"  
    repository: "https://charts.bitnami.com/bitnami"
    condition: redis.enabled
  - name: rabbitmq
    version: "14.6.6"
    repository: "https://charts.bitnami.com/bitnami"
    condition: rabbitmq.enabled
```

### Breaking Changes
- None (initial release)

### Migration Guide
- None (initial release)

---

## Versioning Strategy

This Helm chart follows [Semantic Versioning](https://semver.org/) with the following conventions:

### Version Format: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes that require manual intervention
  - Template structure changes
  - Required value changes
  - Kubernetes API version updates
  - Dependency major version updates

- **MINOR**: New features and enhancements (backward compatible)
  - New optional configuration options
  - New services or components
  - Dependency minor version updates
  - Performance improvements

- **PATCH**: Bug fixes and security updates (backward compatible)
  - Bug fixes
  - Security patches
  - Documentation updates
  - Dependency patch version updates

### Release Process

1. **Development**
   - Feature branches: `feature/feature-name`
   - Bug fixes: `fix/bug-description`
   - Security: `security/cve-description`

2. **Testing**
   - Automated testing with helm-unittest
   - Integration testing on multiple Kubernetes versions
   - Security scanning with tools like Trivy

3. **Release**
   - Update Chart.yaml version
   - Update CHANGELOG.md
   - Create GitHub release with notes
   - Publish to Helm repository

### Compatibility Matrix

| Chart Version | Kubernetes | Helm | Agenta App Version |
|---------------|------------|------|--------------------|
| 0.1.x | 1.19+ | 3.8+ | 0.50.x |
| 0.2.x | 1.20+ | 3.8+ | 0.51.x |
| 0.3.x | 1.21+ | 3.9+ | 0.52.x |

### Upgrade Guidelines

#### Minor Version Upgrades (0.1.x → 0.2.x)
- Usually safe with `helm upgrade`
- Review CHANGELOG for new features
- Update values.yaml if new options are desired

#### Major Version Upgrades (0.x.x → 1.x.x)  
- **Always** review breaking changes
- Test in staging environment first
- May require values.yaml modifications
- May require manual intervention

#### Patch Version Upgrades (0.1.0 → 0.1.1)
- Safe to apply immediately
- Primarily bug fixes and security updates
- No configuration changes required

### Deprecation Policy

- Features will be marked as deprecated for at least one MINOR version
- Breaking changes will be announced in CHANGELOG
- Migration guides will be provided for major changes
- Security-related changes may bypass normal deprecation cycle

### Support Matrix

| Version | Status | Security Updates | Bug Fixes | New Features |
|---------|--------|------------------|-----------|--------------|
| 0.1.x | Stable | ✅ | ✅ | ✅ |
| 0.0.x | EOL | ❌ | ❌ | ❌ |

---

## Contributing to Changelog

When contributing changes, please:

1. Add entries to `[Unreleased]` section
2. Use the following categories:
   - `Added` for new features
   - `Changed` for changes in existing functionality  
   - `Deprecated` for soon-to-be removed features
   - `Removed` for now removed features
   - `Fixed` for any bug fixes
   - `Security` for vulnerability fixes

3. Include relevant issue/PR numbers
4. Be specific about breaking changes
5. Update version compatibility if needed

### Example Entry Format

```markdown
### Added
- New HorizontalPodAutoscaler support for API service (#123)
- Prometheus metrics endpoints for all services (#124)

### Changed  
- Default resource limits increased for production workloads (#125)
- Ingress configuration now supports multiple hosts (#126)

### Fixed
- ConfigMap template rendering issues (#127)
- Service discovery DNS resolution problems (#128)

### Security
- Updated dependencies to address CVE-2024-XXXXX (#129)
```