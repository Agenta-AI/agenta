# Implementation tasks

All tasks are unimplemented. PR #6944 contains specifications only.

## 1. Source and format

- [ ] 1.1 Implement the internal source resolver and provenance mapping; verify default-key resolution, unknown-source rejection, and immutable provenance tests.
- [ ] 1.2 Implement single-agent manifest validation against the example and minimal fixture; verify optional notes/policies and reject multi-agent input before writes.
- [ ] 1.3 Map MCP references through current gateway/configuration services; verify OAuth/API-key/no-auth fixtures and precise unsupported-transport errors.

## 2. Load resources

- [ ] 2.1 Compose package fields with existing agent model/harness/sandbox defaults; verify parity with ordinary creation for the same project and user.
- [ ] 2.2 Create instructions, skills, and copied workspace resources through existing services; verify saved resource read-back and partial-copy recovery.
- [ ] 2.3 Enforce caller/project authorization and request deduplication at existing service boundaries; verify cross-project rejection, concurrent create, and payload conflicts.

## 3. Handoff

- [ ] 3.1 Assemble one normal first message from optional setup guidance, choices, and pending recipes; verify no hidden context contract, no secrets, and no loader-created triggers.
- [ ] 3.2 Extend general session-input deduplication where required for the idle path; verify atomic same-key acceptance, two-tab delivery, timeout replay, and payload conflict tests.
- [ ] 3.3 Replace the existing template loading call while retaining its controls and navigation; verify /m at desktop/phone sizes and the older host.

## 4. Acceptance

- [ ] 4.1 Execute every scenario in this change with commit-specific evidence and saved-resource read-back; mark unrun cases explicitly.
- [ ] 4.2 Run one ordinary build-kit setup smoke conversation after handoff; verify it can request a connection and propose an automation without any template-specific tool.
- [ ] 4.3 Confirm subagent creation remains unsupported and report the separate multi-agent proposal as NOT IMPLEMENTED.
