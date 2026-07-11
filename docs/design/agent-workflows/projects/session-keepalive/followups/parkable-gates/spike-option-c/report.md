# Findings: does a Pi gate ride the ACP permission plane, and does it park?

Date: 2026-07-09. Box: hetznerdev. Steps: [protocol.md](protocol.md). Raw transcripts:
[evidence/](evidence/).

## The question in one line

Option C of the parkable-gates design claims a Pi approval can stop being a file-relay poll and
become a real ACP `session/request_permission` that the runner holds as a parkable promise,
using only what exists today: Pi's extension `ctx.ui.confirm` and the `pi-acp` bridge's
extension-UI translation. If true, the runner's slice-2 park machinery (hold the request, park
the session, `respondPermission` on resume) covers Pi with a new gate type and almost no new
mechanism. The spike drove a real Pi session under the real bridge and answered five questions.

## Verdicts

| # | Question | Verdict |
|---|---|---|
| Q1 | Does `ctx.ui.confirm` from inside a `tool_call` hook surface as a real ACP `session/request_permission`, mid-gate? | **PROVEN.** The dialog arrives as `session/request_permission` while the tool call is pending. |
| Q2 | Does the gate's identity (tool name, call id, arguments) survive the hop? | **Natively no, with the envelope yes.** The bridge sends strings only; a JSON envelope in the message field round-trips byte-exact, including quotes, backslashes, Japanese, and newlines. |
| Q3 | Does the gate hold for minutes (park) without a reaper? | **PROVEN.** Held 180067 ms with no timeout; the late allow ran the original call with its original token inside one uninterrupted `prompt()`. |
| Q4 | What do deny, clean reject, and transport drop do? | Deny and reject resolve `confirm=false`, the hook blocks, `execute` never runs. A transport drop kills `pi-acp` and Pi cleanly; degradation is tier-2 session resume. Fail-closed everywhere. |
| Q5 | Does the same shape survive the `sandbox-agent` path the runner ships on? | **Source-verified** (one live daemon run remains as a confidence check). `acp-http-client@0.4.2` forwards `requestPermission` unchanged; the runner's responder routes a spec-less gate onto the slice-2 park machinery. |

Bottom line: Option C works. The Pi gate becomes the same held, answerable, parkable ACP
request the Claude gate is, with zero changes to Pi, zero changes to the bridge, and the
payload carried by an envelope until an upstream field exists.

## Q1 evidence: the hop is real, mid-gate

In the `allow` run, the model called `park_probe`, the hook raised `ctx.ui.confirm`, and the
client received a real permission request while the tool call sat pending
(`evidence/allow-transcript.jsonl`):

```
17:41:23.929 A->C session/request_permission
  toolCall: { toolCallId: "pi-ui-8f9a...", kind: "other", status: "pending",
              title: "agenta-approval", rawInput: { method: "confirm", ... } }
  options: [ {optionId: "yes", kind: "allow_once"}, {optionId: "no", kind: "reject_once"} ]
17:41:23.933 A->C session/update tool_call_update
  toolCallId: "call_6JFT..." status: "completed"
  content: "EXECUTED park_probe token=TOKEN-ALLOW-a1b2"
17:41:24.761 A->C session/prompt.result stopReason: "end_turn"
```

The answer resolved the held dialog, the hook returned allow, and the original `execute` ran
with the original token. Path confirmed end to end: extension -> Pi RPC `extension_ui_request`
-> `pi-acp` `handleExtensionConfirm` -> `conn.requestPermission`
(`pi-acp/dist/index.js:1106-1128`).

## Q2 evidence: strings natively, everything with the envelope

Natively the bridge synthesizes the ACP tool call from the dialog: `toolCallId`
`pi-ui-<uuid>`, `rawInput` `{method, title, message}`. The real gate identity is not there.
The spike's hook therefore packed it into the message as JSON, with a hostile probe string:

```
message: {"v":1,"gate":"pi-custom-tool","harness":"pi","toolName":"park_probe",
          "toolCallId":"call_6JFT...","input":{"token":"TOKEN-ALLOW-a1b2"},
          "probe":"quotes\"and\\back\\slashes and 日本語 and \n newline"}
```

The envelope arrived byte-exact on the client (`evidence/allow-transcript.jsonl`, the
`request_permission` line). So the payload-fidelity gap closes with parsing, not with upstream
work. The caveat that matters for the runner: without envelope parsing, the gate would key as
`toolName="agenta-approval"`, `args={method,title,message}`, which would put the wrong
identity on approval cards, the durable decision map, and permission policy. Parsing the
envelope into the real gate identity is runner work item 1.

## Q3 evidence: the park is the default, not an engineering feat

In the `hold` run the client received the permission request at 17:42:21.378, heartbeated for
three minutes without answering, then answered yes:

```
17:42:21.378 A->C session/request_permission   (held, no answer)
   ... 180067 ms pass, no reaper fires, session stays alive ...
17:45:21.454 A->C tool_call_update status: "completed"
   content: "EXECUTED park_probe token=TOKEN-PARK-9f9f"
17:45:22.198 A->C session/prompt.result stopReason: "end_turn"
```

One uninterrupted `prompt()`, original call, original arguments, `end_turn` only after the
answer. Why no reaper: Pi's RPC dialog helper arms a timeout only when the caller passes
`opts.timeout` or an aborting `opts.signal` (`pi-coding-agent/dist/modes/rpc/rpc-mode.js:
44-80`); the hook passes neither. The relay's `RELAY_TIMEOUT_MS` is never touched on this
path. This inverts the design's framing: Option B has to engineer an unbounded fail-closed
wait into the relay; the dialog path parks out of the box.

## Q4 evidence: deny, reject, and drop are all fail-closed

- `deny` (`evidence/deny-transcript.jsonl`): the `no` answer resolved `confirm=false`, the hook
  returned a block, the tool call reported failed, `execute` never ran, and the turn ended
  cleanly.
- `rejecterr` (`evidence/rejecterr-transcript.jsonl`): throwing from the client's
  `requestPermission` handler (the ACP request errors while the daemon lives) also resolved to
  `confirm=false`; same block, same clean turn end.
- `drop` (`evidence/drop-transcript.jsonl`): EOF-ing the transport while the request was
  pending killed `pi-acp` and the wrapped Pi process cleanly, with nothing executed and no
  orphan left. The degradation is exactly tier 2: the session file holds the pending call
  (the kill-and-resume experiments proved that flush timing), so a later resume is a faithful
  continuation.

## Q5: the sandbox-agent path, from source

Verified in the shipped source rather than a live daemon, to keep the running stack
untouched: `acp-http-client@0.4.2` (`dist/index.js:448-452`) forwards the whole
`requestPermission(request)` to the registered handler unchanged, with a fail-closed
no-handler fallback (cancelled). On the runner side, `attachPermissionResponder`
(`services/runner/src/engines/sandbox_agent/acp-interactions.ts`) routes a gate it has no spec
for onto the user-approval path, which is the slice-2 `pauseUserApproval` /
`respondPermission` park machinery. One live daemon run remains as a confidence check before
the build; it is a residual, not an open design question.

## The most surprising finding

The hard part of Option B, an unbounded wait that stays fail-closed, is the default behavior
of the dialog path. The relay poll needs timeout surgery to park; `ctx.ui.confirm` with no
options parks indefinitely and resolves to a fail-closed `false` on any cancellation. The
mechanism the design was prepared to build already exists one layer up.

## What this means for the design

- Option C is proven and recommended. Two runner work items remain: parse the JSON envelope
  into the real gate identity (name, call id, arguments) wherever permission requests are
  classified, and switch the in-sandbox extension to raise `ctx.ui.confirm` at the gate
  instead of the relay poll (the relay stays for execution).
- Option B stays documented as the fallback: fully in our code, no third-party bridge in the
  path, but three code deltas and a new resume verb that C makes unnecessary.
- The cleanup end state: upstream a structured-metadata field to `pi-acp` (maintainer Sergii
  Kozak, `svkozak/pi-acp`) so the envelope encoding disappears, or carry a pnpm patch.

## Caveats and limits

- Q5 is source-verified, not live-verified; one daemon run is the recorded residual.
- The runs used the codex subscription (`openai-codex/gpt-5.5`) as the model behind Pi;
  the gate mechanics are harness-level and model-independent.
- Versions pinned in the protocol: `pi-coding-agent@0.79.4`, `pi-acp@0.0.29`,
  `@agentclientprotocol/sdk@0.26.0`. The dialog reaper behavior is version-specific to Pi's
  RPC mode helper; re-check on a Pi upgrade.
