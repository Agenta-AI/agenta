# Testing the orchestration console

Three layers, cheapest first. Layer 3 is the one that answers the real question: **does the
agent actually use the console correctly.**

Paths below assume you run from the repo root. The tool lives in `tool/`.

---

## Layer 1 — the plumbing (automated, seconds)

Tests the file protocol: frontmatter round-trip, the decision state machine
(`open → answered → locked`, and that the UI path can never lock), feed sequence numbers stay
unique even under concurrent writes, and `pending` surfaces exactly what the agent must act on.

```
uv run docs/design/agent-workflows/projects/orchestration-console/tool/test_console.py
```

Expected: `11 passed`. If this is green, the store is sound. This is the safety net for any
future change to `console_store.py`.

---

## Layer 2 — the web app + the two-way loop (manual, 2 minutes)

Proves the dashboard renders and that answering a decision in the UI reaches the agent.

1. Start the app (leave it running):

   ```
   uv run docs/design/agent-workflows/projects/orchestration-console/tool/console_web.py \
     --root docs/design/agent-workflows/scratch/console --host 0.0.0.0 --port 8799
   ```

2. Open `http://localhost:8799/`. You should see the `orchestration-console` project (the one
   that tracked this very build). Click in.

3. In **Needs you**, the open decision (`status-md-migration`) shows its full context, options,
   and recommendation, with an answer box. Type an answer and submit.

4. Confirm the loop reached the agent side — this is what the orchestrator reads next turn:

   ```
   uv run docs/design/agent-workflows/projects/orchestration-console/tool/console.py \
     pending --project orchestration-console
   ```

   The decision you just answered appears under `answered_decisions`, with your text and
   `answered_by: user`. That is the proof: your UI answer is now waiting for the agent, no chat
   round-trip.

5. Post a free-text note from the **Leave a note** box; confirm it shows under `notes` in the
   same `pending` output.

To expose the app off this machine, set `CONSOLE_TOKEN=<secret>` before starting it and reach it
with `?token=<secret>`.

---

## Layer 3 — the skill integration (the important one)

The question: when the orchestrator is told to use the console, does it actually create the
right tasks, raise the decision with real context, and update status? Two ways to check.

### 3a. Cold conformance check (repeatable, no live feature needed)

Hand a **fresh sub-agent** only the skill and a scripted scenario, let it drive the CLI, then
inspect the files. It tests whether the skill prose induces the behavior, in isolation.

1. Pick an isolated root so it does not touch real projects, e.g.
   `--root /tmp/console-conformance`.
2. Spawn a sub-agent with a prompt like: *"Use the `orchestration-console` skill. You are
   orchestrating feature X. You dispatched three sub-agents (A done, B running and blocked on a
   fork, C queued). Raise one decision for the user about the fork. Record all of it with the
   CLI, root `/tmp/console-conformance`."* (The exact prompt used to validate this build is in
   `status.md` under "conformance check".)
3. Assert the result — this is the rubric:

   ```
   uv run .../console.py --root /tmp/console-conformance status  --project <id>
   uv run .../console.py --root /tmp/console-conformance pending --project <id>
   ```

   - three tasks exist with the right statuses (`done`, `blocked`, `queued`);
   - the blocked task's `blocked_on` points at the decision id;
   - one decision is `open` with a non-empty Context, at least two Options, and a Recommendation;
   - the feed has a `decision_raised` event and a summary `message`;
   - `pending` is empty (the user has not answered yet).

   If all hold, the skill induces correct behavior. This check is cheap to re-run whenever the
   skill or the CLI changes — it is the regression test for the *integration*, not just the code.

### 3b. Live end-to-end (a real effort)

The real test is one real orchestration. Next time you kick off a multi-thread feature or a
debugging session:

1. Tell the orchestrator to **track it in the console** (or run it through `implement-feature`
   / `queue-implement-feature`, which now call the console at their phase hooks).
2. Watch the dashboard fill as sub-agents get dispatched: tasks flip `queued → running →
   in-review`, decisions appear under **Needs you**, the feed narrates.
3. Answer a decision in the UI. On its next turn the orchestrator runs `console pending`, acts on
   your answer, and locks the decision. Confirm the decision moves to **locked** and the feed
   shows `decision_answered` (by you) then `decision_locked` (by the agent).

The success criterion is simple and behavioral: **for one whole effort, you never had to open
chat to ask "what's the status" or to answer a decision.** If a decision or a running task ever
lived only in chat, that is a skill-adherence miss — tighten the skill discipline, not the code.

---

## What each layer catches

| Layer | Catches |
|---|---|
| 1 plumbing | protocol bugs (state machine, feed races, parsing) |
| 2 web + loop | the dashboard renders; UI answers reach `pending` |
| 3a conformance | the skill wording actually makes the agent record things right |
| 3b live | the whole loop removes chat round-trips in real use |
