# Session keep-alive: open questions

None of these block starting slice 1. They refine defaults and edge behavior. Each states a working default so the plan can proceed if Mahmoud does not weigh in.

1. **Idle TTL default.** 60 seconds is the working default. Longer means more follow-up messages land on the live session; longer also means more idle RAM held per parked session. Is 60 seconds right for the playground's typical pause between messages?

2. **Approval TTL default.** 10 minutes is the working default. This is how long a parked approval holds its session and permission request open while it waits for a human. Longer helps a human who steps away; longer also holds idle resources. Is 10 minutes right, and should it differ for local versus Daytona later?

3. **Pool cap default.** About 8 sessions is the working default. This bounds total idle RAM on one replica. What is the realistic concurrent-conversation count per replica we should size for?

4. **History fingerprint over the pruned array.** DECIDED (2026-07-08 review fold): the fingerprint is computed over the sent (pruned) array, and unit tests pin the contract so a future frontend pruning change trips a test instead of silently invalidating continuations. A miss degrades to cold replay, never a wrong continuation.

5. **Supersede versus reject on a racing second turn.** The working default is supersede: if a second turn arrives while a session is busy, destroy and cold-start the new turn. The alternative is to reject the second turn. Supersede is simpler and matches "never fail a turn". Confirm supersede is acceptable.

6. **Config fingerprint field list.** The plan hashes config-bearing fields (harness, sandbox, model, provider, deployment, endpoint, credentialMode, agentsMd, system prompts, tools, skills, custom tools, MCP servers, permissions, sandbox permission, harness files, workflow revision id and version, is_draft) and excludes per-turn volatiles (messages, turnId, trace propagation, rotating telemetry headers, secret values). Is any field misclassified? This is the one contract worth a careful pass with the design-interfaces lens before code. Note (2026-07-08 review fold, corrected by the confirmation pass): credential rotation is handled by the credential epoch on the park record, not by the config fingerprint. Secret values stay out of the CONFIG fingerprint; the epoch itself uses a process-local hash over the resolved secret values (runner memory only, never logged, persisted, or emitted), because the wire carries raw values and no version identity, so an identity hash would miss a same-slug rotation.

Decisions folded from the 2026-07-08 Codex review and its confirmation pass (recorded, not open): slice 2 v1 parks Claude ACP permission gates only (plan.md Q7 scope table); listeners are session-lifetime with a current-turn demux; the pool key is `<projectId>:<sessionId>` with the project scope taken from the mount-sign response (`mount.project_id`), and a session with no mount credentials never parks; parks carry a credential epoch (mount expiry + process-local value hash); a resumed approval executes with the original turn's baked environment while the new turn owns streaming and tracing; a partial acquireEnvironment failure cleans up through the incrementally registered finalizers.
