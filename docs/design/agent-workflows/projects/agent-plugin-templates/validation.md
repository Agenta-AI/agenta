# Validation and acceptance

The canonical requirements and WHEN/THEN scenarios are in [the OpenSpec change](../../../../../openspec/changes/load-single-agent-templates/proposal.md). This document defines evidence and code-review expectations. Runtime implementation has not been performed in PR #6944.

## Product acceptance

| Area                    | Expected result                                                                                         | Evidence required from implementation                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Template entry          | Existing cards, controls, navigation, and connection-step placement remain unchanged.                   | Browser recording of /m on desktop and phone viewports and the older web host.                |
| Source                  | Existing key resolves to the internal source; source/version/digest are retained.                       | Source fixture and saved provenance read-back.                                                |
| Agent                   | One agent receives the declared name, description, and instructions.                                    | Configuration read-back, not only a successful response.                                      |
| Model                   | Same selection rules as ordinary creation.                                                              | Parity tests for the same user/project, including unavailable credentials.                    |
| Skills/files            | Declared resources exist before first-message delivery.                                                 | Skill reference and mount read-back; failure/retry case.                                      |
| Connections             | Existing choices survive. Missing choices are setup needs, not invalid native configuration.            | Native-schema validation, selected-provider test, and first-message inspection.               |
| MCP                     | Existing gateway and auth flows handle supported endpoints; unsupported transports have precise errors. | OAuth/API-key/no-auth cases, missing endpoint, and transport rejection cases.                 |
| First message           | Setup instructions and pending recipes appear once in the normal message.                               | Persisted transcript/input read-back for idle, concurrent, refresh, and timeout delivery.     |
| Responsibility boundary | Loading succeeds at message acceptance without a setup status or readiness gate.                        | Inspect API models and direct-run behavior; no installation resource or template setup tools. |
| Automation              | Loading activates no schedule or subscription.                                                          | Trigger read-back before handoff; ordinary approval behavior in a subsequent smoke run.       |
| Multi-agent             | Explicitly unsupported in version one.                                                                  | Report NOT IMPLEMENTED and test rejection before writes.                                      |

## Code invariants

- Validate and resolve source paths before writing resources. Reject malformed references, extra agents, and unsafe startup files without partial creation.
- Authorize caller, project, and all referenced resources before mutation. Test foreign-project accounts, secrets, workflows, and mounts.
- Keep parsing/compilation pure. Existing resource services own writes; no foreign-domain table manipulation or duplicated provider clients.
- Use ordinary creation defaults, not a second template model resolver.
- Keep MCP options to kind and key. Native services own endpoint/authentication details. Omitted permission overrides preserve current defaults.
- Copy workspace entries in backend code. All setup notes are optional, with file-related guidance only in SETUP.md.
- Atomically deduplicate create and session-input requests; same-key changed-payload requests conflict. A frontend latch alone is insufficient.
- Preserve user-edited files on retry. Do not replay the whole load after a partial copy error.
- Do not expose credentials in package content, metadata, setup messages, logs, or traces.
- Keep subsequent self-configuration on the existing build kit. Add a general capability only for a demonstrated gap; do not add template-specific tools.

## Evidence and limits

Each runtime scenario needs an implementation commit SHA, fixture, command or browser path, result, and redacted evidence. Inspect actual resources independently of UI badges. Mark unrun cases NOT RUN. Mark all deferred subagent scenarios NOT IMPLEMENTED even if their schema and OpenSpec format checks pass.

The docs-only checks are OpenSpec strict validation, JSON Schema validation of current/future/minimal examples, reference/link checks, formatting, and diff checks. Those checks validate the documents; they do not prove runtime support.

A post-handoff build-kit smoke run checks that the instructions are usable. It does not add a product pilot, setup-completion metric, or new rollout lifecycle to the loading feature's acceptance boundary.
