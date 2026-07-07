# Session keep-alive: open questions

None of these block starting slice 1. They refine defaults and edge behavior. Each states a working default so the plan can proceed if Mahmoud does not weigh in.

1. **Idle TTL default.** 60 seconds is the working default. Longer means more follow-up messages land on the live session; longer also means more idle RAM held per parked session. Is 60 seconds right for the playground's typical pause between messages?

2. **Approval TTL default.** 10 minutes is the working default. This is how long a parked approval holds its session and permission request open while it waits for a human. Longer helps a human who steps away; longer also holds idle resources. Is 10 minutes right, and should it differ for local versus Daytona later?

3. **Pool cap default.** About 8 sessions is the working default. This bounds total idle RAM on one replica. What is the realistic concurrent-conversation count per replica we should size for?

4. **History fingerprint over the pruned array.** The frontend prunes turns with no answer part (`hasAnswer`) before sending, so the server sees fewer messages than the user does. The history fingerprint must be computed over the sent (pruned) array, not the displayed one. Confirm this is the intended contract, since a future change to the pruning would silently invalidate continuations.

5. **Supersede versus reject on a racing second turn.** The working default is supersede: if a second turn arrives while a session is busy, destroy and cold-start the new turn. The alternative is to reject the second turn. Supersede is simpler and matches "never fail a turn". Confirm supersede is acceptable.

6. **Config fingerprint field list.** The plan hashes config-bearing fields (harness, sandbox, model, provider, deployment, endpoint, credentialMode, agentsMd, system prompts, tools, skills, custom tools, MCP servers, permissions, sandbox permission, harness files, workflow revision id and version, is_draft) and excludes per-turn volatiles (messages, turnId, trace propagation, rotating telemetry headers, secret values). Is any field misclassified? This is the one contract worth a careful pass with the design-interfaces lens before code.
