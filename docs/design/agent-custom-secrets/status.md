# Status

## Current phase

Implementation and independent review are complete. Runtime, SDK, runner, shared entity, shared UI, desktop, and mobile paths are present in the isolated feature worktree. The real-application request, resume, and targeted recovery checks passed. The remaining runtime matrix is listed below.

## Shipped decisions

- Variant revisions own `agent.sandbox.credentials` references.
- The vault owns secret content and optional `default_env_var` metadata.
- The shared form places the optional default directly below **Value**.
- Request, secret default, and derived suggestion determine the initial binding in that order. User overrides apply only to the attachment.
- Settings and `request_secret` share the Secret form controller. Advanced configuration and the request dock share the attachment drawer.
- Secret attachments stay inside the existing **Advanced** agent configuration drawer.
- Save, adoption, settlement, and resume form one ordered host transaction. Retry after partial save reuses the saved vault entry.
- V1 uses existing secret-edit, agent-edit, and run permissions. It adds no role system.
- Runtime values travel only in typed `sandboxCredentials` and participate in existing redaction and credential lifecycle controls.

## Validation evidence

- Local Pi S1 passed injection, same-slug rotation, removal, continuity, and no-plaintext assertions.
- The real desktop request flow passed request, cancellation without repetition, dummy-secret save,
  v1 commit, adoption before resume, same-session resume, and a matching Python SHA-256 file side
  effect. The fixed value was a test sentinel, not a credential.
- The real Advanced flow passed create/default/override, refresh, edit, removal, revision
  adoption, partial-save retry without another vault create, dirty-draft blocking, and failed-removal retry. See [browser evidence](qa-browser-evidence.md).
- Failed-resume recovery passed after an injected HTTP 503. Retry preserved the saved revision and session with no vault create or revision commit.
- The frontend transaction suite passes six tests for commit and adoption behavior.
- The real chat hook suite passes ten tests, including adopted-revision auto-resume.
- The production Storybook build contains 719 entries. Headless Chrome rendered the native request card, request-to-create drawer, requested `GITHUB_TOKEN` default, and preserved designer reference.
- The web lint run passed all 25 tasks.
- Entity transforms and UI attachment helpers passed their package suites.

The Daytona live run is blocked because the environment has no usable OpenAI credential. This is an environment blocker, not a passing Daytona result.

## Remaining release work

- Run the remaining Pi, Claude, and Codex matrix across local and Daytona. Daytona currently needs
  a usable model credential in the disposable project.

Use [the browser checklist](qa-browser-checklist.md) for the remaining UI verification.

## Storybook

Native stories are published under:

- `@agenta/entity-ui/Secret/AgentSecretAttachmentDrawer`
- `@agenta/entity-ui/Secret/SecretRequestDock`

The original designer asset remains under `Design review/Agent custom secrets`. Storybook packages the reference through `.storybook` static directories, and its manager and preview heads preserve the cache-busting `index.json` behavior.
