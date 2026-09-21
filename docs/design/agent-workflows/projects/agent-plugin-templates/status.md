# Status

## Implemented

PR #6944 implements single-agent loading from internal versioned packages, native skills and workspace files, project-scoped bindings, idempotent resource creation, and a durable first user-message handoff. Both UI hosts use the loader. First-turn UI capabilities and the generic display-content contract are implemented. Created agents appear in the agent list and their sessions in the sidebar.

The temporary QA catalog entries and starter cards have been removed after testing. Existing created agents and conversations are preserved. Multi-agent loading remains **NOT IMPLEMENTED** and is not part of this release.

## Review follow-up

CodeRabbit corrections cover MCP field names, optional setup/description contracts, entry/reference validation, immutable outbound package revision 1.0.1, plan examples, and fixture links. Workspace writes now use an S3 conditional create. Session inputs persist a one-shot dispatch claim before invocation; ambiguous timeouts cannot cause a second dispatch. This requires migration oss000000033 for both editions. A process loss between claim and invocation needs operator recovery after checking the remote execution, rather than an automatic redispatch. API errors no longer expose low-level exception text.

Browser creation now retains the original request across failed attempts and reloads until success or explicit cancellation. Staged attachments are copied into the server-owned session with project/session ownership checks. Creation replay returns the original revision even after later user edits. The legacy in-place host adopts the returned session.

## OpenSpec next steps

- Complete load-single-agent-templates tasks 6.3 and 6.4: forced timeout recovery and two browser tabs racing the first submission across the host/viewport matrix; an ordinary missing-connection and inactive-recipe build-kit conversation.
- Run strict validation after the final edits and keep unrun scenarios marked NOT RUN.
- Archive the single-agent change only after acceptance and merge. Keep support-template-subagents deferred and unarchived.

## Superpowers next steps

- Update the implementation evidence on the final PR head after the remaining acceptance checks.
- Complete final code review and CI after the review fixes. The old plan's unchecked test-first recipe is historical; OpenSpec tasks and this status file are the progress ledger.
- Finish the development branch only after approval to merge. No merge or branch cleanup has been performed.

Historical deployed evidence is recorded in the display-content implementation plan and PR. Schema validation alone is not runtime acceptance.


## Review verification, 2026-09-21

The review follow-up passed 1,673 backend tests (142 skipped), 19 frontend registry/loading tests, and 25 SDK reference tests. Both frontend hosts pass TypeScript checks. Both OpenSpec changes pass strict validation. A live SeaweedFS conditional-create check preserved an existing object; a PostgreSQL concurrent claim and fresh-DAO replay check allowed one dispatch. The preview migration was applied before API restart. A browser-created PR reviewer received its staged attachment, read its verification code, and reopened the same server session after refresh. The gallery shows 28 production cards.

The legacy in-place handoff has a corrected callback, active-session adoption, and URL, but its final live creation check remains unverified. The full viewport/two-tab/forced-timeout matrix and missing-connection/inactive-recipe conversation remain open under OpenSpec tasks 6.3 and 6.4. These results do not replace those acceptance tasks.
