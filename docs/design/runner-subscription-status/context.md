# Context

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current user experience

The user can select **Subscription** in the model credentials section. The frontend then shows a
self-managed information card and a link to the self-hosting guide.

The user must start the runner with a mounted login folder. Agenta does not show whether the runner
is active or whether the login file exists. The user learns about an incorrect setup only after a
run fails.

## Goal

Show whether the selected harness can find its subscription login before the user starts a run.

The first version reports local configuration. It does not prove that the provider accepts the
login. A successful model run remains the final proof.

## Non-goals

- Do not send a login token to Agenta Cloud.
- Do not send login file contents to the frontend.
- Do not contact OpenAI, Anthropic, or another provider during a status request.
- Do not start a paid model run during a status request.
- Do not add the dynamic status to the static harness catalog.
- Do not support subscription login in a Daytona sandbox. The current runner rejects this mode.

## Success criteria

- The frontend can distinguish a runner that is not reachable from a runner with no login.
- The frontend can show whether the selected harness has a usable local login file.
- The status request does not expose secrets or local file paths.
- An old runner does not break the page. The frontend shows an unknown status.
- The status can change without a page reload after the user starts the runner or signs in again.
