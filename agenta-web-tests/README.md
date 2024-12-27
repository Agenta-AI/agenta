# Agenta Web Tests

End-to-end tests for Agenta web application.

## Usage Examples

Run tests against specific environments in parallel:

```bash
# Run against multiple environments
npm run test:e2e -- --project staging --project beta

# Run cloud-only features
npm run test:e2e -- --project staging-cloud-only --project beta-cloud-only

# Run with test filters
npm run test:e2e -- --project staging -- --project beta --grep @scope:auth

# Control parallelism
npm run test:e2e -- --project staging --project beta --workers 4
```

## Available Projects

- `local` - OSS features only
- `local-cloud` - All features
- `staging` - All features
- `beta` - All features
- `staging-cloud-only` - Cloud features only
- `beta-cloud-only` - Cloud features only

## Test Tags

Tests can be filtered using the following tags:

- `@scope:` - Test category (auth, apps, playground, etc.)
- `@coverage:` - Test coverage level (smoke, sanity, light, full)
- `@path:` - Test path type (happy, grumpy)
- `@feature-scope:` - Feature availability (cloud-only, common)

## Project Structure

```
agenta-web-tests/
├── tests/
│   ├── fixtures/      # Test fixtures
│   ├── cloud/         # Cloud-specific tests
│   └── oss/          # OSS-specific tests
├── playwright/
│   ├── config/       # Test configuration
│   └── scripts/      # Test runner scripts
└── playwright.config.ts
```
