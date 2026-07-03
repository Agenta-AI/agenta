# PR #4936 explained, in plain language

This doc explains every change in PR #4936 ("Harden agent round-trip QA paths"),
with the context you need to follow it. It is written to be read cold. Where a
detail is still being verified in code, the doc says so.

PR #4936 merged into `big-agents` on 2026-06-30. It is the change that made two
agent features work end to end for the first time, plus a set of supporting fixes
that got swept into the same PR.

---

## The big picture

The PR did four things:

1. Made `request_connection` work: an agent can ask the user to connect an
   account (Slack, GitHub), and the playground shows a "Connect / Retry" widget.
2. Made `commit_revision` work: an agent can edit its own config and save a new
   version, and the playground moves to that new version.
3. Fixed two infrastructure problems that blocked the above (where the runner
   thinks the API lives; how the browser reaches a builtin app).
4. Added supporting display and validation tweaks.

The rest of this doc walks each one.

---

## Feature 1: `request_connection` (client tools)

### What a "client tool" is

Most tools run on the server or in the sandbox. A **client tool** is different.
The browser fulfills it. `request_connection` is the example: when the agent
calls it, the user's browser runs the connect flow (the OAuth popup or API-key
form), and the agent waits for the result.

### What was broken

The agent could never call `request_connection`, because the runner filtered
client tools out before the model ever heard about them. So the feature did
nothing.

### What the PR changed

A chain of small changes, all serving one goal: let a browser-fulfilled tool
reach the model, get "parked" when the model calls it, and resume after the
browser finishes.

- `tools/public-spec.ts`: client tools are now advertised to the model (with
  their `kind` and `render` info), instead of hidden.
- `tools/dispatch.ts` and `tools/relay.ts`: a client tool call is no longer
  answered with a fake "pending" stub. It is handed to the runner, which
  **parks** it (pauses the turn) and asks the frontend to take over.
- `engines/sandbox_agent.ts`: when a client tool is parked, the runner emits an
  `interaction_request` event of kind `client_tool`.
- `adapters/vercel/stream.py`: that event becomes the stream parts the UI needs
  to draw the connect widget.
- `core/workflows/static_catalog.py`: `request_connection` got a real input
  schema (`integration` plus optional `slug` and `mode`).

### Known gaps (being addressed)

- **This works on the Pi harness only.** On a Claude run the tool reaches nobody:
  the MCP bridge filters client tools out, and the fallback path that would catch
  them is dead code. The run still looks healthy, so it is a silent break. We are
  fixing this (client tools must work on Claude).
- The park logic exists in two places, one of which is dead. We are consolidating
  it to one.

---

## Feature 2: `commit_revision` (the agent edits itself)

### What was broken: two separate bugs

**Bug A: the tool did not know which variant to update.** The agent must never
pick which config to edit; it always edits the one it is running. That target is
filled in for it, server side. The mechanism was returning nothing in the
playground, so the commit had no target. The deep dive below explains exactly
why.

**Bug B: the tool wiped the config.** The model sends only the fields it wants to
change. The old endpoint treated that partial payload as the whole new config, so
everything the model left out got deleted.

### What the PR did, and what replaced it

For Bug B, #4936 added a second endpoint, `/revisions/commit/patch`, that
deep-merges the partial payload onto the current config. This is the part you did
not like, because it put merge logic into the core workflows router.

**This is now superseded.** A few hours after #4936 merged, JP committed a cleaner
version (`4ae6289d68`, "patch > delta ?"). He deleted the forked patch endpoint and
folded the choice into the single commit endpoint: a commit carries either `data`
(full replace) or `delta` (operations merged onto the latest revision). His `delta`
model supports set and, it appears, delete. We are keeping JP's version and
building the agent-facing `commit_revision` tool on top of it.

---

## Deep dive: how an agent knows which variant to edit

This is the part that caused the most confusion, so here is the whole path.

### The rule

`commit_revision` is an "update yourself" tool. The model is **not allowed** to
name the variant. That field is removed from the schema the model sees, and the
description tells the model "do not set this." The runner fills it in.

### Where the runner gets the value

Two different things are easy to confuse, so let us separate them:

- **As a tool argument:** the variant id is never a tool argument. The model never
  sends it, and the frontend never sends it as part of the tool call. It is wiped
  before binding. This is the security guarantee: the model cannot retarget a
  different variant.
- **As the invocation target:** the frontend **does** send which app, variant, and
  (when not a draft) revision is being run. It sends this as the run's reference
  set, not as a tool argument. This is the part you were right about, and where my
  earlier wording was imprecise.

So when you run a saved (non-draft) config, the frontend sends the app, variant,
and revision references on the run request. The backend resolver reads those and
stamps them onto the run's tracing context. The agent service then reads the
variant id back out of the tracing context and binds it to the tool. The runner
gets the value "from the tracing context" because that is where the resolver put
the resolved invocation target.

### Why it came up empty in the playground (Bug A)

A playground app run records its references under the **application** family keys
(`application`, `application_variant`, `application_revision`). The code that built
the run context read only the **workflow** family keys (`workflow*`). The names did
not match, so the read found nothing, the variant id was empty, and the binding
had nothing to bind. The injection mechanism itself was fine. The producer used one
key family and the consumer read another.

The fix taught the consumer to also read `application*` and `evaluator*` keys and
map them into the one workflow shape.

### The draft case (being verified)

For a saved revision, all three references are present. For a **draft** (an unsaved
inline config), there is no revision reference yet. The open question is how
`commit_revision` then picks what to update. The intended rule we discussed is
"latest revision of the default variant." A research thread is confirming the exact
draft behavior in code before we rely on it.

### Quick answers to your specific questions

- "The service gets the binding from the tracing context, right?" Yes.
- "The middleware does not save this anywhere else?" As traced so far, the tracing
  reference set is the single source. Being confirmed.
- "The context injection happens where it is supposed to?" Yes. The binding step
  was never the bug.
- "Were we invoking the application incorrectly?" Not exactly. The references were
  sent. The bug was that the reader looked for the wrong key family.
- "Does the frontend send the variant id?" Yes, as the invocation target (not as a
  tool argument). For non-draft runs it sends app + variant + revision.

---

## The runner needs to know where the API lives (server.ts)

### Context

The agent runner sometimes has to call back to the Agenta API mid-run: to read or
write session state, to run a server tool, or to commit a revision. To do that it
needs the API's base URL, in the `AGENTA_API_URL` setting.

### What the change does

When the runner owns the session and `AGENTA_API_URL` is not already set, it
**guesses** the API base URL from a different setting on the request: the telemetry
(tracing) endpoint. That endpoint looks like `https://host/api/otlp/v1/traces`. The
code cuts everything before the `/otlp/` part to get `https://host/api`.

### Why this is a hack

It ties the API address to the exact shape of the telemetry URL. If telemetry
routing ever changes and the `/otlp/` part moves or disappears, this silently
returns nothing and the callbacks lose their address. The clean fix is to pass the
API base URL on the request directly, because the caller already knows it. It is
routing information, and we should send it as routing information, not reverse it
out of a tracing setting. We are fixing this in its own PR.

---

## How the browser reaches a builtin app (runnableSetup.ts)

### Context

The playground invokes an app by having the **browser** POST to the app's
`/invoke` URL. So that URL must be one the browser can actually reach over the
public internet.

The problem: an app's stored URL can be a **Docker-internal hostname**. Inside the
server cluster, services talk to each other by internal names like
`http://agenta-api:8000`. The browser, sitting on someone's laptop, cannot reach
those names at all. If the stored URL is one of those, the invoke fails before
anything else happens. Some stored URLs were also stale, pointing at an old
domain after a migration.

### What the change does

For builtin apps, instead of trusting the stored URL, the code now rebuilds a
clean public URL from the app's URI. It takes the public API origin the browser is
already using and appends the service path, giving something like
`https://app.agenta.ai/services/agent`. That is guaranteed reachable from the
browser. Custom apps and evaluators keep the old behavior.

### Resolved: it was a hack (moved to its own thread)

You were right. It was a hack masking a self-inflicted bug (an agent `commit_revision`
self-update wrote the agent service's internal URL into the stored config). Fixed properly in
PR #4982. The full write-up and the one open decision (migrate the poisoned rows vs
correct-on-read) now live in the thread file **`08-builtin-invoke-url.md`**.

---

## The build-kit overlay shows the right revision (revisionId threading)

### Context

The "playground build kit" is the read-only block in the Advanced section that
shows the default tools, skills, and permissions an agent comes with. The platform
serves this as an overlay, and the overlay is fetched **per revision**.

### What the change does

The control that renders this block was not being told which revision is open, so
it could not fetch the matching overlay. The change passes the open revision's id
down through `useModelHarness` into `useBuildKit`, so the block shows the overlay
for the revision you are actually looking at. Small, real fix, tangential to the
two features.

Why the overlay is tied to the revision: the overlay is fetched and cached **keyed by
the revision id** (the atom holding it is a per-revision family). To look it up, the
component must know which revision is open. It was not being told, so it could not
fetch the overlay at all. The change passes the open revision's id down so the block
reads the overlay for the revision on screen. The link to the revision is a cache-key
and data-fetch detail, not that each revision carries a very different overlay.

---

## Smaller bits

- **`run-plan.ts` (useToolRelay):** the relay loop used to start only when there
  were "executable" tools. Client tools are not executable (the browser fulfills
  them), so a run with only `request_connection` never started the relay and the
  tool could never be parked. The change starts the relay whenever any tool is
  present. The cost is that on Daytona this runs a remote check several times a
  second for the whole turn on client-tool runs. Worth a follow-up backoff.

  More plainly: the "relay" is a background loop the runner keeps during a turn that
  watches for tool calls the model makes and handles them (runs them, or parks them).
  The loop used to start only when there was at least one *executable* tool, meaning a
  server or code tool the runner itself runs. A client tool is not executable; the
  browser runs it. So a run whose only tool was `request_connection` started no relay
  loop, and when the model called it, nothing was watching to park it, so it hung. The
  change starts the loop whenever any tool exists, including client tools, so the call
  gets parked. On Daytona the loop checks for work by running a small remote command on
  a timer, so it now does that on client-only runs too. A follow-up will slow that timer
  when there is nothing executable to run.
- **`sandbox_agent.ts` logging:** one debug line printing tool counts and whether
  client tools were advertised. Harmless, helps diagnose problems.

---

## The "{}" tool input display

In the stream UI, both tools show their input as `{}` even when they worked. The
frontend and SDK are not dropping it. The cause differs by tool:

- **`request_connection`:** the model really is calling it with empty arguments,
  because the schema the model sees does not force `integration` to be present, and
  the connect widget tolerates an empty value. Fix: make `integration` required so
  the empty call is rejected and the model retries. (Approved.)
- **`commit_revision`:** this one is a display artifact. The tool executed with the
  full data (the commit succeeded). But the displayed/traced input is captured once
  from the first tool-call event and never refreshed, so if the first event had an
  empty input it stays empty on screen. The fix is in the runner: refresh the
  recorded input when the later event arrives. (Needs a bit more thought.)

  What "refresh" means here: overwrite the recorded value with a newer, fuller one. When
  the model calls a tool, the runner records the tool's input once, from the FIRST event
  about the call, to show in the UI and the trace. On the Claude path that first event
  sometimes carries an empty input, and the real arguments arrive in a LATER event. The
  runner never goes back to update the recorded input, so the screen keeps the empty
  `{}` from the first event even though the tool ran with full data. Refreshing means
  updating that recorded input when the later event arrives with the real arguments.

---

## What we decided to change (summary)

- Keep JP's `delta` model for `commit_revision`. Drop the #4936 patch-endpoint
  revert. Build the agent-facing `commit_revision` as a tool on top of JP's delta.
- Client tools must work on Claude, with no silent breakage.
- Add `connect` to the typed render vocabulary instead of letting it pass
  untyped.
- Keep required-field validation on client tools (a client tool's required fields
  are the ones the model must supply to start the flow).
- Fix the chat-history loss on commit (defer the revision switch until the turn
  settles).
- Make `integration` required for `request_connection`.
- Clean up the API-base-URL guess in its own PR.

The live tracker for all of this is `STATUS.md` in this folder.
