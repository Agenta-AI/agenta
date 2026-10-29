/**
 * HOST-LEVEL WIRING TEST for the approval dock.
 *
 * The dock's own test mocks the registry; this one does not. It keeps the REAL approvals registry,
 * the REAL operations reader, and the REAL `getPendingApprovals` (how the playground turns a
 * transcript into dock props), and feeds a production-shaped assistant turn: an
 * `approval-requested` tool part plus the runner's sibling `data-approval-manifest` part.
 *
 * The invariant it guards is the point of the redesign: whatever the payload looks like, the card
 * renders prose. No JSON, no diff, no digest, no byte counts — in any mode, for any user.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

// The always-allow affordance is the package's, with its own unit test, and it is the dock's only
// network boundary.
vi.mock("@agenta/chat/hooks", () => ({
    useAlwaysAllowTool: () => ({
        infoFor: () => ({eligible: false, alreadyAllowed: false}),
        grant: () => undefined,
    }),
}))

const {default: ApprovalDock} = await import("./ApprovalDock")
const {getPendingApprovals} = await import("@agenta/chat/model")

/** The turn shape the egress produces: the gated tool part, plus the manifest as a sibling. */
const assistantTurn = (input: unknown, manifest?: unknown, toolName = "commit_revision") => [
    {
        id: "msg-1",
        role: "assistant" as const,
        parts: [
            {
                type: `tool-${toolName}`,
                toolCallId: "call-1",
                state: "approval-requested",
                approval: {id: "approval-1"},
                input,
            },
            ...(manifest === undefined
                ? []
                : [
                      {
                          type: "data-approval-manifest",
                          id: "call-1",
                          data: {toolCallId: "call-1", approvalId: "approval-1", manifest},
                      },
                  ]),
        ],
    },
]

/** The ordered arm, as production sends it. */
const ORDERED_INPUT = {
    description: "Rewriting the greeting so it says you are a QA test agent.",
    workflow_revision: {
        base_revision_id: "019fd397-5a0b-77b1-b63e-e4fdcb42862c",
        delta: {
            operations: [
                {
                    operation: "add_item",
                    target: ["parameters", "agent", "skills"],
                    value: {
                        name: "deslope",
                        description: "Softens statements that read as too intense",
                    },
                },
            ],
        },
    },
}

const MANIFEST = {
    version: 1,
    files: [
        {
            relativePath: "instructions.md",
            requestedPath: ".agenta-imports/instructions.md",
            bytes: 2048,
            digest: "abcdef0123456789",
            executableBit: false,
        },
    ],
    diffs: [
        {
            targetField: "instructions",
            baseRevisionId: "019fd397-5a0b-77b1-b63e-e4fdcb42862c",
            oldBytes: 100,
            newBytes: 2048,
            diff: "@@ -1 +1 @@\n-old\n+new",
            addedLines: 1,
            removedLines: 1,
            diffTruncated: false,
        },
    ],
    totalBytes: 2048,
    contentDigest: "fedcba9876543210",
}

const render = (input: unknown, manifest?: unknown, toolName?: string) =>
    renderToStaticMarkup(
        <ApprovalDock
            approvals={getPendingApprovals(assistantTurn(input, manifest, toolName) as never)}
            onApprovalResponse={() => undefined}
            entityId="rev-1"
        />,
    )

describe("the ordered commit gate", () => {
    it("describes the change in words the payload never contained", () => {
        const markup = render(ORDERED_INPUT)

        expect(markup).toContain("Needs your approval")
        expect(markup).toContain("Save 1 change to this agent")
        expect(markup).toContain("New skill · deslope")
        expect(markup).toContain(">Approve<")
    })

    it("shows no payload, no delta, and no raw target path", () => {
        const markup = render(ORDERED_INPUT)

        expect(markup).not.toContain("workflow_revision")
        expect(markup).not.toContain("base_revision_id")
        expect(markup).not.toContain("019fd397")
        expect(markup).not.toContain("Payload")
    })

    it("names imported workspace content without a diff, a digest, or a byte count", () => {
        const markup = render(ORDERED_INPUT, MANIFEST)

        expect(markup).toContain("instructions.md")
        expect(markup).not.toContain("fedcba9876543210")
        expect(markup).not.toContain("abcdef0123456789")
        expect(markup).not.toContain("@@")
        expect(markup).not.toContain("2048")
    })

    it("resolves the describer through the harness prefix, not the wire name", () => {
        const markup = render(ORDERED_INPUT, undefined, "mcp__agenta-tools__commit_revision")

        expect(markup).toContain("New skill · deslope")
    })
})

describe("a payload the commit describer cannot read", () => {
    it("falls back to a sentence rather than dumping the arguments", () => {
        const markup = render({workflow_revision: {delta: {}}})

        expect(markup).toContain("Needs your approval")
        expect(markup).not.toContain("workflow_revision")
        expect(markup).not.toContain("delta")
    })
})

describe("an ordinary tool gate", () => {
    it("labels each readable argument instead of showing the payload object", () => {
        const markup = render(
            {command: "rm -rf build", cwd: "/srv/app", options: {timeout: 30}},
            undefined,
            "bash",
        )

        expect(markup).toContain("Command")
        expect(markup).toContain("rm -rf build")
        expect(markup).toContain("Cwd")
        // The nested object has no readable rendering, so it gets no row at all.
        expect(markup).not.toContain("timeout")
        expect(markup).not.toContain("{&quot;")
    })
})
