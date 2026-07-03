# Thread 04 — Chat output lost when the playground switches revision

## Context

After `commit_revision` succeeds, the playground switches to the new revision and the
chat history (at least the output of the triggering turn) disappears.

## Explanations

- #4936 added a `switchEntity` call when the commit event arrives
  (`AgentChatPanel.tsx:416-431`).
- That changes the displayed revision id, which is the React `key` for the chat panel
  subtree (`MainLayout:339-345`). A new key unmounts and remounts the conversation.
- On remount it re-seeds messages from local storage. But the assistant output was not
  saved yet, because persist is skipped while streaming (`AgentChatPanel.tsx:404-407`)
  and the commit event arrives mid-stream. The remount also aborts the live stream.
- Result: the user message survives (saved at submit), the assistant output is gone.

## History

- #4936 introduced the switch.
- Root-caused as a remount-during-stream bug.
- You approved the fix.

## Open decision threads

**D1. Fix approach — approved.**
Defer `switchEntity` until the stream settles (gate on run status), and persist the
transcript right before switching so correctness does not depend on effect order. Avoid
the bigger refactor (decoupling the panel id from the entity id) since it touches the
shared key used by other panels.

Your decision: **escalated to a proper fix, not a quick hotfix.** You also hit a second
symptom: switching the entity/revision drops the chat with "connection lost." That makes this
trickier than a one-line defer. So thread 04 now goes through plan-feature -> Codex review ->
implement-feature, with live debug-local-deployment QA of BOTH symptoms. The likely real fix
is to DECOUPLE the chat panel identity from the entity id, so a revision switch never remounts
or reconnects the conversation. An investigation + plan is running now.

Slack: **done — you posted the heads-up to Arda yourself.**

### B. Connection lost on entity switch (new symptom)
You observed that switching the revision also produces a "connection lost" in the chat, on top
of the lost transcript. Being investigated alongside A; the working theory is the same remount
aborting the live stream, or the new revision failing to reconnect. The plan must fix both.

**PLAN DONE** (`projects/agent-chat-revision-switch/`): both symptoms are ONE root cause — the
conversation is keyed by the revision id (`MainLayout` `key={variantId}`) and REMOUNTS on every
switch. History loss = persist is skipped mid-stream so the answer is never saved; "connection
lost" = the remount aborts the in-flight stream and the fresh mount never resumes. The hotfix is
necessary-but-insufficient (a separate manual revision-switch in the config header is not
covered, and every switch still remounts). The DECOUPLE is the real fix and is small/low-risk:
key the agent panel by a stable session-scoped token (not the revision id), read the revision via
a ref at send time, keep persist-on-settle as defense. **Ready for your review, then implement.**

**Your decision: approve the decouple.** Flow (the standard rule): codex xhigh reviews the plan ->
address his meaningful points -> /style-editing cleanup of the docs (final design only, drop the
history) -> open a DRAFT PR with the cleaned plan for your LGTM -> THEN implement -> review (subagent +
codex) -> /debug-local-deployment -> iterate until BOTH the reviews are clean AND debug works ->
open the implementation PR -> your LGTM -> merge. Codex review of the plan is running now (batched
with the otel.ts review); the draft PR is queued behind the cleanup PR.

**Codex review of the plan (done):** root cause confirmed, but the plan was incomplete. It must
also (a) use a STABLE LINEAGE key, not a bare constant; (b) fix a SECOND remount source — the
`Splitter` keyed by `isAgentConfig` (a switching revision momentarily looks non-agent); (c) correct
a wrong claim (the expanded create/edit drawer DOES use the same mount path, so it is affected);
(d) note that a queued message uses the revision current at RELEASE, not at typing; (e) expand the
tests. A doc agent is folding these in and style-cleaning the plan; then it becomes the draft PR
for your gate-1 LGTM.
