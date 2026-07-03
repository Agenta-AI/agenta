# agent-chat-revision-switch

Investigation + plan for the agent-chat revision-switch bug: switching the playground
revision (after `commit_revision`, or by a manual version pick) loses the chat transcript
and drops the live stream ("connection lost").

Root cause: the agent conversation is mounted inside a host that React keys by the revision
id, so any revision switch **remounts** the conversation, re-seeding from storage without the
unpersisted mid-stream output and aborting the in-flight stream. Two host keys change on a
switch (the `ExecutionItems` key and the `Splitter` key, which bounces while the new revision's
flags load), so both must be fixed.

## Files

- `research.md`: both symptoms with file:line evidence; the two remount sources; why the data
  is not truly lost; blast-radius facts (including the corrected drawer finding).
- `design.md`: the **decouple** as the final design: stable agent-panel mount key, a stable
  `isAgentConfig` so the splitter key does not bounce, and entity id read as a live prop at send
  time. Plus surfaces covered (main + expanded drawer), blast radius, risks, and a test +
  live-QA plan.

## Bottom line

Decouple the chat panel's mount identity from the entity id: conversation identity = session
(app-scoped, stable); revision = per-run config read at send time. Fix mount identity in the
host layout (`MainLayout`), keep run config in `AgentChatPanel` / `buildAgentRequest`. The
expanded create/edit drawer shares the same `MainLayout` path, so the same fix covers it (QA it,
do not assume it). Live QA runs later, when the dev stack is free.

Prior context: `docs/design/agent-workflows/scratch/pr-4936-followup/04-chat-history-loss.md`.
</content>
