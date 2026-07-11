# Status

## Phase

Research and plan complete. Design-only. The planning workspace is committed on
`docs/daytona-secret-delivery` for a draft PR. No implementation, dependency update, or Daytona
resource was created.

## Recommendation

Proceed with a live security spike, then implement per-sandbox ephemeral Daytona organization
Secrets for direct HTTP credentials on Daytona.

The requested "not an organization Secret" property is not available in Daytona's model. Secrets
are organization-scoped by definition and must remain there while the sandbox uses them. The safe
approximation is a unique random Secret per sandbox binding, exact host allowlists, no descriptive
metadata, and deterministic cleanup.

## Decisions captured

- Agenta vault remains the source of truth.
- Do not mirror the whole vault into Daytona.
- Do not put Agenta control-plane credentials into Daytona Secrets.
- Use Daytona substitution only for unchanged HTTP(S) credentials.
- Reject unsupported credential shapes instead of falling back to plaintext.
- Keep destination policy attached to the credential use, not in a separate loose map.
- Pin an exact Daytona SDK version.
- Own the small Daytona provider adapter in Agenta so create, pause, destroy, and Secret cleanup
  share one lifecycle.
- Retain leases across resume and delete them only after confirmed sandbox deletion.

## Important blockers and risks

1. Daytona Secrets is recent and needs a live adversarial spike before adoption.
2. Daytona publishes no documented Secret quota or automatic TTL/cascade behavior.
3. The runner's Daytona API key needs broad `manage:secrets` permission.
4. The current sandbox-agent Daytona provider does not implement native pause.
5. The current Agenta named-secret SDK client calls a batch endpoint absent from the vault router.
6. Bedrock, Vertex service-account, signing, JSON, and native-protocol credentials cannot use
   placeholder substitution.
7. Local sandboxes remain unsolved by this feature.

## Decision needed before implementation

Approve or reject the recommended first scope:

> Phase 0 security spike plus standard direct model API keys and exact-host custom-provider API
> keys on Daytona. Custom text secrets follow only after the explicit consumer and host-policy
> contract is reviewed.

This scope proves the security boundary without introducing a generic agent secret surface.

## Next action

Review this workspace. If approved, open a design PR based on `big-agents` with the Phase 0 spike
and Phase 1 dependency/provider work as the first implementation milestone.
