# Status

## Current status

We have aligned on a 3-PR approach.

### Active workstream

- **PR 1:** add missing Kubernetes workers
- GitButler branch: `fix/k8s-add-missing-workers`
- Implemented locally:
  - `worker-webhooks`
  - `worker-events`

### Validation done

- `helm lint hosting/helm/agenta-oss`
- `helm template` confirmed both new worker deployments render
- isolated OSS install attempted in namespace `agenta-pr1`
- isolated OSS smoke install succeeded in namespace `agenta-pr1-smoke` with `cron.enabled=false`
- `helm test agenta-pr1-smoke -n agenta-pr1-smoke` succeeded

## Decisions made

- Keep Docker Compose untouched
- Use isolated Kubernetes namespaces/releases for testing
- Split the work into 3 PRs
- Use `AGENTA_LICENSE` for the OSS/EE switch in PR 3
- Add curated `values-oss.example.yaml` and `values-ee.example.yaml`
- Keep billing and Cloudflare Turnstile unset by default for self-hosted EE
- Add docs updates in each PR, not only at the end

## Known blockers / caveats

- EE published images may require GHCR package access not yet verified in this session
- Importing local-built images into k3s may require root access
- New Relic wrapping may differ between OSS and EE published images
- Current OSS chart on `v0.95.1` has an existing unrelated cron issue:
  - `supercronic /app/crontab` fails with `no such file or directory`
  - this caused the full install in namespace `agenta-pr1` to fail the Helm `--wait` phase
  - PR 1 remains scoped to the missing workers; cron follow-up should be handled separately unless scope is intentionally expanded

## Next steps

1. Review final diff for PR 1
2. Commit changes on `fix/k8s-add-missing-workers`
3. Push branch and open PR 1
