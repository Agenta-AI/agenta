/**
 * Unit tests for `agentShouldResumeAfterApproval` — the agent-lane HITL resume predicate
 * passed to `useChat`'s `sendAutomaticallyWhen`.
 *
 * The load-bearing case is RESEND-ON-DENY: a deny-only decision must re-send the
 * conversation so the runner receives the denial round-trip and the model continues. The
 * deny dead-end (F-036) was the tool stuck in `approval-responded` with no resume request.
 */
import {describe, expect, it} from "vitest"

import {agentShouldResumeAfterApproval} from "../../src/state/execution/agentApprovalResume"

const user = (text: string) => ({id: "u1", role: "user", parts: [{type: "text", text}]})

const assistantWithTool = (state: string, approved?: boolean) => ({
    id: "a1",
    role: "assistant",
    parts: [
        {type: "step-start"},
        {
            type: "tool-deleteFile",
            toolCallId: "call_1",
            state,
            input: {path: "/x"},
            approval: approved === undefined ? {id: "perm_1"} : {id: "perm_1", approved},
        },
    ],
})

/** A parked client tool (e.g. `request_connection`): no approval, `providerExecuted` falsy. */
const assistantWithClientTool = (state: string, output?: unknown) => ({
    id: "a1",
    role: "assistant",
    parts: [
        {type: "step-start"},
        {
            type: "tool-request_connection",
            toolCallId: "call_c",
            state,
            input: {integration: "github"},
            ...(output === undefined ? {} : {output}),
        },
    ],
})

describe("agentShouldResumeAfterApproval", () => {
    it("RESUMES on a deny-only decision (the F-036 dead-end fix)", () => {
        const messages = [user("do it"), assistantWithTool("approval-responded", false)]
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })

    it("resumes on an approve decision too", () => {
        const messages = [user("do it"), assistantWithTool("approval-responded", true)]
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })

    it("does NOT resume while a gate is still pending (approval-requested)", () => {
        const messages = [user("do it"), assistantWithTool("approval-requested")]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("does NOT resume when there is no tool part", () => {
        const messages = [
            user("hi"),
            {id: "a1", role: "assistant", parts: [{type: "text", text: "hello"}]},
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("does NOT resume when the last message is a user message", () => {
        const messages = [assistantWithTool("approval-responded", false), user("again")]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("does NOT resume when a sibling tool on the turn is unsettled", () => {
        const messages = [
            user("do two"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-deleteFile",
                        toolCallId: "call_1",
                        state: "approval-responded",
                        input: {path: "/x"},
                        approval: {id: "perm_1", approved: false},
                    },
                    {
                        type: "tool-readFile",
                        toolCallId: "call_2",
                        state: "approval-requested",
                        input: {path: "/y"},
                        approval: {id: "perm_2"},
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("resumes when a responded gate sits alongside an already-completed tool", () => {
        const messages = [
            user("do two"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-deleteFile",
                        toolCallId: "call_1",
                        state: "approval-responded",
                        input: {path: "/x"},
                        approval: {id: "perm_1", approved: false},
                    },
                    {
                        type: "tool-readFile",
                        toolCallId: "call_2",
                        state: "output-available",
                        input: {path: "/y"},
                        output: {ok: true},
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })

    it("does NOT resume while ONE of two concurrent approval cards is still pending", () => {
        // Concurrent approvals: one turn shows TWO approval-requested gates (two distinct
        // toolCallIds). Answering only the first must NOT resume — the second is still pending,
        // so the run stays parked until EVERY card is settled.
        const messages = [
            user("do two"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-deleteFile",
                        toolCallId: "call_1",
                        state: "approval-responded",
                        input: {path: "/x"},
                        approval: {id: "perm_1", approved: true},
                    },
                    {
                        type: "tool-deleteFile",
                        toolCallId: "call_2",
                        state: "approval-requested",
                        input: {path: "/y"},
                        approval: {id: "perm_2"},
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("RESUMES once BOTH concurrent approval cards are answered", () => {
        // Same two-gate turn, now both answered (one approve, one deny). Every card is settled
        // (`approval-responded`), so the run resumes and the runner gets both round-trips.
        const messages = [
            user("do two"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-deleteFile",
                        toolCallId: "call_1",
                        state: "approval-responded",
                        input: {path: "/x"},
                        approval: {id: "perm_1", approved: true},
                    },
                    {
                        type: "tool-deleteFile",
                        toolCallId: "call_2",
                        state: "approval-responded",
                        input: {path: "/y"},
                        approval: {id: "perm_2", approved: false},
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })

    it("does NOT resume when there are no messages", () => {
        expect(agentShouldResumeAfterApproval({messages: []})).toBe(false)
    })

    it("RESUMES when a parked client tool is fulfilled (output-available)", () => {
        const messages = [
            user("connect github"),
            assistantWithClientTool("output-available", {
                connected: true,
                integration: "github",
                slug: "github-main",
            }),
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })

    it("RESUMES when a client tool settles as a failure (cancel/abandon/error)", () => {
        const messages = [
            user("connect github"),
            assistantWithClientTool("output-error", undefined),
        ]
        // output-error counts as settled even with no `output` payload (errorText path).
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })

    it("does NOT resume while a client tool is still parked (input-available)", () => {
        const messages = [user("connect github"), assistantWithClientTool("input-available")]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("does NOT resume while a client tool is still streaming its input", () => {
        const messages = [user("connect github"), assistantWithClientTool("input-streaming")]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("resumes when a fulfilled client tool sits alongside a responded approval", () => {
        const messages = [
            user("do it then connect"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-deleteFile",
                        toolCallId: "call_1",
                        state: "approval-responded",
                        input: {path: "/x"},
                        approval: {id: "perm_1", approved: true},
                    },
                    {
                        type: "tool-request_connection",
                        toolCallId: "call_c",
                        state: "output-available",
                        input: {integration: "github"},
                        output: {connected: true, integration: "github", slug: "github-main"},
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })

    it("does NOT resume when a fulfilled client tool sits beside an unsettled sibling", () => {
        const messages = [
            user("connect both"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-request_connection",
                        toolCallId: "call_c",
                        state: "output-available",
                        input: {integration: "github"},
                        output: {connected: true, integration: "github", slug: "github-main"},
                    },
                    {
                        type: "tool-request_connection",
                        toolCallId: "call_d",
                        state: "input-available",
                        input: {integration: "slack"},
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("does NOT resume for a settled SERVER tool (the read-skill / Aloha-loop regression)", () => {
        // A server tool the agent ran itself (e.g. the `read` skill auto-loaded each turn) settles
        // to output-available with providerExecuted falsy and no approval — but it is NOT a client
        // tool (no render.kind, not a known client-tool name). It must not trigger a resume, or
        // every tool-using turn auto-resends forever.
        const messages = [
            user("Aloha"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-read",
                        toolCallId: "call_read_1",
                        state: "output-available",
                        input: {},
                        output: "---\nname: agenta-getting-started\n---\n",
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("does NOT resume for an APPROVED tool that ran (output-available WITH approval)", () => {
        // An approval-gated tool that was approved and then produced output keeps its `approval`
        // field. It is not a parked client tool — the turn already continued — so it must not be
        // read as a client-tool result (else the queue gate, which composes this, holds forever).
        const messages = [user("do it"), assistantWithTool("output-available", true)]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("does NOT resume once the model continued past the approval (post-resolve loop guard)", () => {
        // The cold-replay resume APPENDS to the same assistant message: after the approved gate,
        // a new step (`step-start`) begins and the tool re-runs under a fresh id (output-available).
        // The original `approval-responded` part lingers — but the turn already resumed, so a
        // SECOND auto-resend would re-run the whole turn forever. A step-start AFTER the resolved
        // approval is the "already resumed" signal.
        const messages = [
            user("show config"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-Terminal",
                        toolCallId: "call_old",
                        state: "approval-responded",
                        input: {command: "cat settings.json"},
                        approval: {id: "perm_1", approved: true},
                    },
                    {type: "step-start"},
                    {
                        type: "tool-Terminal",
                        toolCallId: "call_new",
                        state: "output-available",
                        input: {command: "cat settings.json"},
                        output: "No global settings found",
                    },
                    {type: "text", text: "Here's the current configuration…"},
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(false)
    })

    it("STILL resumes on a chained second approval later in the turn", () => {
        // Two gates in one turn: the first was approved-and-resumed (step-start follows it), then a
        // SECOND gate was just approved and is the tail — its approval still needs the resume.
        const messages = [
            user("do two"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-Terminal",
                        toolCallId: "call_1",
                        state: "approval-responded",
                        input: {command: "a"},
                        approval: {id: "perm_1", approved: true},
                    },
                    {type: "step-start"},
                    {
                        type: "tool-Terminal",
                        toolCallId: "call_2",
                        state: "approval-responded",
                        input: {command: "b"},
                        approval: {id: "perm_2", approved: true},
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })

    it("ignores provider-executed tool parts when deciding completeness", () => {
        const messages = [
            user("do it"),
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    {
                        type: "tool-deleteFile",
                        toolCallId: "call_1",
                        state: "approval-responded",
                        input: {path: "/x"},
                        approval: {id: "perm_1", approved: false},
                    },
                    {
                        type: "tool-providerThing",
                        toolCallId: "call_p",
                        state: "approval-requested",
                        providerExecuted: true,
                        input: {},
                        approval: {id: "perm_p"},
                    },
                ],
            },
        ]
        expect(agentShouldResumeAfterApproval({messages})).toBe(true)
    })
})
