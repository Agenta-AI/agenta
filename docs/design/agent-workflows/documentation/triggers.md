# Triggers

Triggers are planned. They are not implemented in the current agent workflow code.

## Concept

A trigger connects an external source event to an Agenta target. This is the same class of
problem as webhooks:

| Source | Event | Target |
| --- | --- | --- |
| Agenta webhook source | Agenta event JSON | HTTP destination |
| Compose.io trigger source | Compose.io event JSON | Agenta workflow or agent message |

The POC should start with Compose.io because it gives us real event sources and lifecycle
APIs. The abstraction should not bake Compose.io into the core model.

## Event To Agent Mapping

The useful default is to pass the full event JSON as the message body or as an input
variable available to the message template.

Then the user can override the message shape by templating from the event, using the same
mental model as completion variables:

```text
New issue from {{event.repository.full_name}}:
{{event.issue.title}}
```

The first implementation can keep this simple:

- Default message: the whole event JSON.
- Optional message template: renders from the event context.
- No hard-coded GitHub, Gmail, Linear, Slack, or PostHog mappings in the core agent path.

## Lifecycle

The platform needs two layers of state:

- Agenta state: which project, agent/workflow, target, session policy, and message template
  this trigger belongs to.
- Provider state: the Compose.io subscription id, connection/account identity, and provider
  lifecycle metadata.

That implies a port-and-adapter shape:

- `TriggerProvider` or equivalent port with `subscribe`, `unsubscribe`, `list`, and event
  normalization operations.
- `ComposeTriggerProvider` as the first adapter.
- Agenta service state that can survive provider retries and reconcile subscriptions.

## UI Placement

Trigger configuration belongs near the agent/playground flow because the user is wiring an
event into a specific agent behavior. It can reuse concepts from global Automations, but it
should not be hidden only under global settings.

## Missing Work

- Define the trigger DTOs and storage model.
- Build the Compose.io lifecycle POC.
- Define event delivery into `/messages`, `/invoke`, or a dedicated internal target.
- Decide session behavior for triggered runs: always new session, fixed session id from the
  event, or user-configured mapping.
- Add the event template renderer and validation.
- Add UI affordances for connection, source event selection, target agent selection, and
  test delivery.

