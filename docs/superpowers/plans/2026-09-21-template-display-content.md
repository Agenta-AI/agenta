# UI template creation: implementation plan

Requested by Mahmoud on 2026-09-21 for PR #6944. The approved display contract is implemented through startup, transport, records, and both frontend hosts. The earlier preview fixes are included in the same PR.

## What changes

A template-created UI agent must receive the same runtime capabilities as an ordinary UI-created agent from its first turn. Previously the server started the first turn without the playground additions; only browser follow-up turns added them. The fix belongs at the first invocation boundary, not in the template's saved tools.

Reuse the canonical playground build-kit definitions and the normal configuration merge rules. Carry the UI's enabled/disabled settings into the load request. Compose the compiled package resources with the effective UI additions on a throwaway invocation copy. Retain package skills and files, and keep UI-only tools and skills out of the saved revision. Update typed API transport and regression tests with this contract. Do not add these capabilities to ordinary API or scheduled runs.

## Execution content and display content

The agent service prepares one user message whose `content` contains the original request and labeled template setup guidance. It sets generic optional `display_content` to the original visible request. The runner executes the complete content and preserves `display_content` in the saved message record. No template-specific field or model-adapter composition is required.

The shared frontend rule is: absent `display_content` shows normal content; a string shows that string; explicit null hides the whole message, including attachments. An empty string is an intentional empty text override, not a fallback. Text overrides preserve ordinary attachments. Display and copy use the same rule. Full execution content remains available in authorized records and server-side model history.

The Python Message DTO must preserve field presence through `from_raw()` and `to_wire()`. Vercel UI messages carry the same value in `metadata.display_content`; conversion in both directions retains the value without changing the execution parts. The runner ChatMessage and message-event interfaces carry `display_content?: string | null`. The record writer copies the field only when supplied. Cold history reconstruction continues to read complete execution text.

Before records arrive, the frontend already knows the user's request and can render it as the pending message. Both hosts must reconcile pending and durable versions using stable input/execution/message identity. Do not compare text because the stored execution text includes setup guidance. Preserve the full execution content in conversation state; apply the display override only when rendering or copying. Editing and resending need an explicit preservation test so changing visible text cannot silently discard or duplicate setup guidance.

Template startup must set display content before durable input claiming so fingerprints include both execution and display content. Keep template composition on the server. Do not hide text by matching a setup prefix. Keep template instructions at user level. The agent can discuss setup in its response.

## Implementation and verification

The loader composes full execution text and sets `display_content` before durable input admission. The first UI run applies the canonical build kit to a copy of the compiled parameters, respecting the enabled setting and disabled operations. The saved revision retains package resources only. The UI transfers those settings to the created revision for later turns.

The shared display projection preserves full conversation state. Both hosts use it for rendering and copy. Pending server inputs use the same display semantics. Existing execution identities reconcile pending and recorded rows. Explicit null hides the whole row. Text overrides retain attachments.

Editing a displayed turn keeps its original execution text and appends a clearly labeled updated user request. It does not guess where template guidance starts. The visible override becomes the edited request. The pending edit source survives a page refresh in session storage when browser storage is available. Queued inputs with display overrides cannot be edited through the ordinary queue text editor, which cannot preserve their execution context; they can still be removed.

Validation covers SDK round trips, runner persistence and cold reconstruction, backend loader/start behavior, saved versus runtime tools, disabled operations, frontend projection/copy, and edit preservation. Live QA on the isolated Hetzner preview verified:

- Actual first-turn request_input forms and answer submission for all three QA sources.
- Setup, skill, reference, workspace-file, and deterministic script facts in the project-brief response.
- Original visible request only in chat and copied text, including refresh and a fresh browser session.
- A later turn after restarting the runner recovered the original setup word from saved history.
- Exactly one initial user record, with full execution text and separate display content.
- Zero schedules and subscriptions in the dedicated QA project after the automation fixture ran.
- Saved fixture revisions each contain one package skill and zero tools; the initial invocation includes 21 runtime tools.
- The legacy playground and /m at phone and desktop widths render the same visible request.

The three temporary QA sources were removed from the runtime catalog and gallery after testing, at Mahmoud’s request. The gallery again contains 28 starter cards. The evidence below describes the historical QA run; existing created agents and conversations are preserved.

## Three test templates

| Template                   | Resources                                                              | Proof                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| QA checklist assistant     | One simple skill                                                       | The skill is installed and the first run uses its output format.                                                                                       |
| QA project brief assistant | A skill with reference and script files, plus declared workspace files | The agent reads the reference and seeded file and produces an answer using fixture-specific facts. A safe deterministic script can verify file access. |
| QA weekly digest assistant | A skill and an inactive schedule recipe                                | The first turn calls request_input for setup details; a form appears and submission resumes the session. No trigger is created merely by loading.      |

Use clearly marked test names and harmless local fixture data. Keep existing integration-gate scenarios, including GitHub/GitLab choice, in the QA pass. Do not post reviews or send external messages as proof.

## Verification and PR delivery

Test the capability merge, disabled operations, saved-versus-runtime configuration, message conversion, persistence, cold reconstruction, and replay conflicts. Run live browser scenarios on /m at phone and desktop widths and the older playground host. Check the actual first-run tool list and a successful request_input call, not the model's claim about available tools.

For hidden context, verify a fixture-specific fact reaches the agent, the setup text is absent from the user-message display and copied text, and both conditions hold after refresh and a cold follow-up. Verify exactly one initial message. Read back installed skills and workspace files and confirm the automation remains inactive.

Include the earlier preview fixes in the same existing PR after review and checks: connection validation, durable startup acknowledgment, mobile authentication-cache refresh, and the integration gate. Commit and push all completed changes to PR #6944, update its stale description, redeploy the resulting commit, and attach the QA outcome with its exact SHA. Do not claim the new requirements are implemented until those checks pass.


## Review verification, 2026-09-21

The review follow-up passed 1,673 backend tests (142 skipped), 19 frontend registry/loading tests, and 25 SDK reference tests. Both frontend hosts pass TypeScript checks. Both OpenSpec changes pass strict validation. A live SeaweedFS conditional-create check preserved an existing object; a PostgreSQL concurrent claim and fresh-DAO replay check allowed one dispatch. The preview migration was applied before API restart. A browser-created PR reviewer received its staged attachment, read its verification code, and reopened the same server session after refresh. The gallery shows 28 production cards.

The legacy in-place handoff has a corrected callback, active-session adoption, and URL, but its final live creation check remains unverified. The full viewport/two-tab/forced-timeout matrix and missing-connection/inactive-recipe conversation remain open under OpenSpec tasks 6.3 and 6.4. These results do not replace those acceptance tasks.
