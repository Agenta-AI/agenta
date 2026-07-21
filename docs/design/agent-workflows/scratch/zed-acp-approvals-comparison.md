# Comparison of human approval handling in Zed and Agenta

## The incident and the design question

In session `db58551b`, the model proposed two parallel shell commands. Each command required human approval. Both commands ran exactly once, and each ran only after the user approved it. No unapproved command executed.

The system failed around that execution. It lost an approval after rebuilding the saved conversation, failed to send the final approval to the runner, misreported both commands, and later treated a new user message as the missing answer to the old task. The companion report reconstructs the incident and defines the seven defects used below (`docs/design/agent-workflows/scratch/debug-concurrent-approvals-db58551b.md:48`).

Zed and Agenta use the same approval adapter and can both keep a live approval request waiting inside an agent process. The important difference appears after Agenta closes the browser response. Agenta needs another browser request to deliver the answer, but its durable record does not contain that answer. Its pause cleanup also assigns final results without reliable evidence from the executor.

The Zed citations below use paths relative to the cloned `agent-client-protocol`, `claude-code-acp`, and `zed` repositories. The Agenta citations use paths relative to this repository.

## ACP assigns execution to the agent and approval to the client

ACP, or the Agent Client Protocol, defines how a coding agent and a user interface communicate. For example, ACP lets Claude Code ask Zed whether it may run `git status`.

ACP uses JSON-RPC, which is a request and response format based on JSON. The sender gives each request an `id`. The receiver eventually returns a response with the same `id`. Several requests can remain unanswered at the same time because their ids keep them separate.

ACP defines two roles:

- The **agent** runs the model and executes its tools. In the example above, Claude Code is the agent.
- The **client** displays the conversation and answers the agent's questions. In the example above, Zed is the client.

A **tool call** is the model's request to perform an action, such as reading a file or running a command. A **permission request** is the agent's request for the human to allow or reject one tool call. The client answers the permission request, but the agent executes the tool. ACP states this division directly (`agent-client-protocol/docs/protocol/v2/tool-calls.mdx:255`).

A **tool-call status** records the call's current stage, such as pending, waiting for confirmation, running, completed, failed, rejected, or canceled. A **turn** contains one user message and the agent work that follows it. A **session** contains the agent's conversation state across turns.

ACP also defines `requires_action`, a session state that means the agent cannot continue until the user acts. The agent should report `requires_action` while awaiting permission and `running` after receiving the answer (`agent-client-protocol/docs/protocol/v2/prompt-lifecycle.mdx:355`).

In Agenta, a **harness** is the agent program that implements the model and tool loop, such as Pi or Claude Code. The runner acts as the ACP client toward that harness. It also streams events to the browser and persists an event stream, which is a chronological record that lets a reloaded page or a second browser rebuild the conversation.

## Zed and Agenta use the same Claude adapter

Zed's `claude-code-acp` repository publishes the same npm package that our runner uses: `@agentclientprotocol/claude-agent-acp`. Zed's repository contains version `0.59.0`, while our runner pins version `0.58.1` (`claude-code-acp/package.json:2`, `claude-code-acp/package.json:6`, `services/runner/package.json:23`).

The adapter does not serialize approvals, which would mean forcing every approval to wait behind the previous one. Its `canUseTool` callback, the function that decides whether a tool may run, awaits `client.requestPermission` without an approval lock or queue (`claude-code-acp/src/acp-agent.ts:4112`, `claude-code-acp/src/acp-agent.ts:4334`). Its only queue, `turnQueue`, orders whole user turns (`claude-code-acp/src/acp-agent.ts:301`, `claude-code-acp/src/acp-agent.ts:1634`).

ACP permits any number of outstanding permission requests, meaning requests that were sent but not yet answered. Each request has its own JSON-RPC id. The specification demonstrates two concurrent requests and later cancels each id separately (`agent-client-protocol/docs/protocol/v2/cancellation.mdx:52`).

If Claude presents approvals one at a time, Claude's own tool dispatch creates that ordering. Neither ACP nor the shared adapter requires it.

## Zed stores each approval on its tool call

Zed processes one approval as follows.

1. The adapter first emits the `tool_call` update. It does this deliberately so the client knows which tool call exists before receiving a permission request that refers to it (`claude-code-acp/src/acp-agent.ts:4112`, `claude-code-acp/src/acp-agent.ts:4153`).

2. Zed creates a **one-shot channel**, which is a channel that carries one value and then closes. In this case, Zed stores the sending end on the tool call and waits on the receiving end until the human chooses allow or reject. The stored sender acts as that call's resolver, meaning it supplies the answer to the waiting request.

3. Zed changes that call's status to `WaitingForConfirmation`. The status contains the approval options and its own one-shot resolver (`zed/crates/acp_thread/src/acp_thread.rs:1258`, `zed/crates/acp_thread/src/acp_thread.rs:3372`, `zed/crates/acp_thread/src/acp_thread.rs:3386`).

4. When the human answers, Zed finds the tool call by id. It changes the status to `InProgress` or `Rejected`, then fires only that call's resolver (`zed/crates/acp_thread/src/acp_thread.rs:3425`, `zed/crates/acp_thread/src/acp_thread.rs:3463`).

The answer is therefore the status transition itself. A redraw reads `InProgress` or `Rejected`; it cannot show the answered call as waiting. Several calls can wait together because each call has its own status and resolver.

Zed normally leaves the permission request pending without a time limit. The live agent process and the current user turn remain open until the human answers or cancels (`zed/crates/acp_thread/src/acp_thread.rs:3372`).

A new user message follows a different path. Zed first cancels the running turn, marks every pending or running tool call as `Canceled`, waits for cancellation to finish, and only then sends the new message to the same session (`zed/crates/acp_thread/src/acp_thread.rs:3724`, `zed/crates/acp_thread/src/acp_thread.rs:3733`, `zed/crates/acp_thread/src/acp_thread.rs:3911`).

The adapter also gives each permission request an `AbortSignal`, which is a cancellation object tied to that request. Aborting it sends `$/cancel_request` for the corresponding JSON-RPC id (`claude-code-acp/src/acp-agent.ts:4105`). ACP requires the client to answer every pending permission request with `cancelled` and recommends marking all unfinished tool calls as canceled (`agent-client-protocol/docs/protocol/v2/prompt-lifecycle.mdx:495`, `agent-client-protocol/docs/protocol/v2/prompt-lifecycle.mdx:497`).

## Agenta has three continuation paths

Agenta does not routinely reconstruct and replay the conversation. It has three paths.

### Warm park and warm resume

To **park** an approval means ending the browser-facing turn while keeping the live harness process and its permission request waiting. A **keepalive pool** is the runner's bounded collection of these live processes. Each entry has a time-to-live limit, which is the maximum time it may remain parked before the runner destroys it (`services/runner/src/engines/sandbox_agent/session-pool.ts:222`).

A **warm resume** continues that same live process. The next browser request checks the process out of the pool and answers the original permission request by its tool-call id. The original prompt then continues in place. The model does not issue the tool call again (`services/runner/src/engines/sandbox_agent/run-turn.ts:433`, `services/runner/src/engines/sandbox_agent/run-turn.ts:471`).

Pi uses this mechanism for builtin tools. Its in-process confirmation waits indefinitely. It allows execution only when the answer is exactly `true`; an error or cancellation denies execution. This is fail-closed behavior (`services/runner/src/extensions/agenta.ts:94`, `services/runner/src/extensions/agenta.ts:112`).

Warm park therefore uses the same pending-request mechanism as Zed. Three differences matter:

1. Agenta bounds the wait with a time-to-live limit and evicts the process when that limit expires. Zed applies no normal approval timeout.
2. Agenta ends the browser-facing turn when it parks. The frontend must send a new resume request to deliver the answer. Zed keeps one turn open, so the answer returns through the still-open request.
3. Agenta's frontend resume trigger failed during the incident. The live permission request remained valid, but its answer never reached it.

### Cold continue

**Session continuity** is the ability to preserve the agent's conversation state when the runner must create a new process or environment. On a keepalive pool miss, Agenta creates a fresh environment and asks the harness to load its own session. The runner finds that session through the harness session id stored on the latest durable session turn (`services/runner/src/engines/sandbox_agent/session-continuity-durable.ts:1`, `services/runner/src/engines/sandbox_agent/session-continuity-durable.ts:58`).

The fresh environment calls the harness's native session load, which means the harness restores its own saved state instead of receiving a reconstructed conversation from Agenta. If loading succeeds, the runner sends only the new user text (`services/runner/src/engines/sandbox_agent/environment.ts:929`, `services/runner/src/engines/sandbox_agent/environment.ts:982`, `services/runner/src/engines/sandbox_agent/runtime-contracts.ts:145`). The model does not reissue the earlier tool calls.

### Failure fallback

Only when the continuity lookup or native session load is unavailable does Agenta use replay as a failure fallback. **Replay** means rebuilding the prompt from Agenta's persisted event history and sending that reconstructed history to a new harness session (`services/runner/src/engines/sandbox_agent/run-turn.ts:124`).

## Agenta persists the request but not the answer

When the runner asks the human for approval, it writes an `interaction_request` event into the durable session record (`services/runner/src/engines/sandbox_agent/acp-interactions.ts:178`). It also creates a pending interaction row.

When the human answers, the browser stores the choice in its local message state and sends it with the resume request (`web/oss/src/components/AgentChatSlice/AgentConversation.tsx:1032`). The runner later changes the interaction row to `resolved`, but that update contains only the lifecycle status. It does not store the allow or deny verdict (`services/runner/src/sessions/interactions.ts:94`, `services/runner/src/sessions/interactions.ts:104`). The protocol defines no `interaction_response` event (`services/runner/src/protocol.ts:363`).

The answer therefore exists only in browser memory and inside the in-flight resume request.

This produces two direct consequences. First, a page reload, a second browser, or a frontend re-render that rebuilds state from the database sees every `interaction_request` as `approval-requested` (`web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts:144`, `web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts:172`). Every answered gate appears to be waiting again.

Second, the frontend sends the resume only when every visible approval card looks settled (`web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:163`). After a rebuild, at least one answered card looks pending. The condition can never become true. This is why the final approval remained in browser memory and the conversation stopped.

## The seven defects differ from Zed at specific boundaries

The hardest execution problem occurs when one call is awaiting approval, another is already executing, and a third has not started. A cleanup pass can see that all three calls remain open, but it cannot infer which actions occurred. That missing evidence caused defects 2 and 3.

| Defect | Comparison with Zed |
|---|---|
| **1. The frontend never dispatches the final answer.** | Agenta waits for every card to look settled before sending a resume. Zed answers one tool-call id immediately and does not depend on sibling cards. |
| **2. The runner reports an approved, executing call as not executed.** | Agenta's post-pause sweep writes a synthetic `DEFERRED_NOT_EXECUTED` error onto open calls, including a call that is already running, then drops its later real result (`services/runner/src/engines/sandbox_agent/run-turn.ts:507`, `services/runner/src/tracing/otel.ts:1479`). Zed advances status only from the selected answer and agent updates. |
| **3. The runner reports a never-started call as a successful empty result.** | Agenta accepts a `completed` closure frame and maps it to success even when execution never began (`services/runner/src/engines/sandbox_agent/runtime-policy.ts:48`, `services/runner/src/tracing/otel.ts:1445`). Zed records unfinished calls as pending or canceled unless the agent reports a real result. |
| **4. The answer is not persisted.** | Agenta saves the permission request but not the verdict. Zed makes the answer a status transition on the tool call. |
| **5. The persisted record overwrites history.** | Agenta derives result-row ids from the session, tool-call id, and event type, without the turn id, so a later result can replace an earlier result (`services/runner/src/sessions/persist.ts:295`). Approval resumes also persist duplicate prompts. Per-call approval status fixes the rebuild problem, but full audit history still requires turn-scoped, append-only rows. |
| **6. A new message resumes the stale task.** | The incident's new message carried the stored approval, so Agenta consumed the request as a resume and completed the old task. Zed cancels the old turn before sending new text. |
| **7. Session-turn append returns HTTP 500.** | This failure affects durable session continuity but is unrelated to approval concurrency. It needs a separate investigation (`docs/design/agent-workflows/scratch/debug-concurrent-approvals-db58551b.md:158`). |

No unapproved command ran in the incident. Pi's builtin confirmation and execution live in the same process, and the confirmation fails closed. This matches Zed's `canUseTool` shape.

The **client-tool relay** is the separate path where the harness asks the runner to execute a product tool on its behalf. Only on that path do the approval gate and executor live in different processes. Runner-side cancellation remains necessary there as a safety backstop.

## Recommended changes

1. Persist each approval answer as a durable status transition on its tool call. Store the allow or deny verdict, actor, and time. A rebuilt conversation must read `approved`, `denied`, or a later execution status instead of reconstructing `waiting` from the request alone. This fixes defects 1 and 4 and the rebuild part of defect 5.

2. Dispatch each approval independently. One click should persist and deliver one answer by tool-call id. The frontend must not wait for every visible card to settle, and one stale card must not block another answer.

3. Cancel before accepting new user work. When new text arrives during pending approvals, the runner should send `session/cancel`, mark unfinished calls canceled, answer every pending permission request with `cancelled`, wait for the harness to report an idle canceled state, and then send the new text as a fresh prompt to the same session. This fixes defect 6 and implements ACP's cancellation contract.

4. Accept only real terminal evidence. Only the executor may mark a call completed or failed. An explicit cancellation may mark it canceled. A pause sweep must not invent a success or a failure for an open call. This removes the false results behind defects 2 and 3 and prevents the retry instruction from repeating a command that already ran.

5. Keep Agenta's durable event stream. Several browsers and page reloads are valid product requirements. The fix is to persist every state transition and scope result records by turn, not to replace durable history with Zed's in-memory state.

6. Investigate defect 7 separately. A failed `session_turns` append weakens cold session continuity, but it did not cause the approval incident.

Updating the shared Claude adapter alone will not fix these defects. The adapter already supports concurrent permission requests and per-request cancellation. The required changes belong in Agenta's browser dispatch, runner state transitions, cancellation path, and persistence model.
