/**
 * HOST-LEVEL WIRING TEST for the approval dock. This is the test class that was missing.
 *
 * The other dock tests mock jotai, the registry's data layer, and the delta classifier, so they
 * assert what the card does ONCE it is given good inputs. They cannot see a production wiring
 * break. One shipped: the card mounted in Chat mode and still rendered a raw JSON payload,
 * because `classifyRevisionDeltaChanges` reads only the legacy `{set, remove}` delta while the
 * agent sends the ordered `{operations}` form. Every mocked test passed through that.
 *
 * So this file keeps REAL jotai atoms (including `chatPanelMaximizedAtom`, driven through a real
 * store the way the Build/Chat toggle drives it), the REAL approvals registry, the REAL delta
 * classifier and operations reader, and the REAL `getPendingApprovals`, which is how the
 * playground turns a transcript into dock props. It feeds a production-shaped assistant turn:
 * an `approval-requested` tool part plus the runner's sibling `data-approval-manifest` part.
 *
 * Only two things are stubbed, and neither carries the logic under test: the entity molecule
 * (the network boundary) and the heavy changes-summary leaf.
 */
import {createStore, Provider} from "jotai"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const params = {
        agent: {instructions: "You are a friendly hello-world agent. Greet the user warmly."},
    }
    return {
        workflowMolecule: {selectors: {serverConfiguration: () => atom(params)}},
    }
})

// Echoes `defaultOpen` so the test can prove the card asks for expanded sections. The real
// component's open-state rule is pinned in the package's own unit test.
vi.mock("@agenta/entity-ui/modals", () => ({
    AgentChangesSummary: ({defaultOpen}: {defaultOpen?: boolean}) => (
        <div>
            {defaultOpen ? "LEGACY_CHANGES_SUMMARY_OPEN" : "LEGACY_CHANGES_SUMMARY_COLLAPSED"}
        </div>
    ),
}))

vi.mock("@/oss/hooks/useAlwaysAllowTool", () => ({
    useAlwaysAllowTool: () => ({infoFor: () => null, grant: () => undefined}),
}))

const {default: ApprovalDock, getPendingApprovals} = await import("./ApprovalDock")
const {chatPanelMaximizedAtom} = await import("../state/panelLayout")

/** The turn shape the egress produces: the gated tool part, plus the manifest as a sibling. */
const assistantTurn = (input: unknown, manifest?: unknown) => [
    {
        id: "msg-1",
        role: "assistant" as const,
        parts: [
            {
                type: "tool-commit_revision",
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

/**
 * The ordered arm, as production actually sends it (the U3/U4 repro).
 *
 * No `message`: with AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED on, the catalog drops `message`
 * from the schema (the server derives it) and closes the object, so an ordered commit CANNOT carry
 * one. The R12 `description` is the only narrative text on the card for these commits.
 */
const ORDERED_INPUT = {
    description: "Rewriting the greeting so it says you are a QA test agent.",
    workflow_revision: {
        base_revision_id: "019fd397-5a0b-77b1-b63e-e4fdcb42862c",
        delta: {
            operations: [
                {
                    operation: "set",
                    target: ["parameters", "agent", "instructions"],
                    value: "You are a friendly hello-world agent. Greet the user warmly and mention you are a QA test agent.",
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
            bytes: 24,
            digest: "abcdef0123456789",
            executableBit: false,
        },
    ],
    diffs: [],
    totalBytes: 24,
    contentDigest: "0123456789abcdef",
}

const renderDock = ({
    chatMode,
    input,
    manifest,
}: {
    chatMode: boolean
    input: unknown
    manifest?: unknown
}) => {
    const store = createStore()
    // Exactly what the playground header's Build/Chat toggle does.
    store.set(chatPanelMaximizedAtom, chatMode)
    const approvals = getPendingApprovals(assistantTurn(input, manifest) as never)
    return {
        approvals,
        markup: renderToStaticMarkup(
            <Provider store={store}>
                <ApprovalDock
                    approvals={approvals}
                    onApprovalResponse={() => undefined}
                    entityId="019fd397-5a0b-77b1-b63e-e4fdcb42862c"
                />
            </Provider>,
        ),
    }
}

describe("the transcript to dock hand-off", () => {
    it("finds the gate and joins it to the runner's sibling manifest part", () => {
        const {approvals} = renderDock({chatMode: false, input: ORDERED_INPUT, manifest: MANIFEST})

        expect(approvals).toHaveLength(1)
        expect(approvals[0].toolName).toBe("commit_revision")
        expect(approvals[0].manifest).toEqual(MANIFEST)
    })
})

describe("an ordered-operations commit, through the real classifier", () => {
    it.each([
        ["Build", false],
        ["Chat", true],
    ])("renders the change and the intent in %s mode, never a bare payload", (_name, chatMode) => {
        const {markup} = renderDock({chatMode, input: ORDERED_INPUT})

        // The change itself, read out of the operations rather than computed.
        expect(markup).toContain("What&#x27;s changing")
        expect(markup).toContain("Replace instructions")
        expect(markup).toContain("mention you are a QA test agent")
        // The old side, resolved from the committed configuration at that target.
        expect(markup).toContain("Now")
        expect(markup).toContain("You are a friendly hello-world agent. Greet the user warmly.")
        // The agent's stated intent, which is the ONLY narrative an ordered commit carries.
        expect(markup).toContain("What the agent says it is doing")
        expect(markup).toContain("Rewriting the greeting so it says you are a QA test agent.")
        // The production symptom: the generic card's payload block was the entire body.
        expect(markup).not.toContain("The agent wants to run this tool before it can keep going.")
    })

    it("still renders the imported content beside the change", () => {
        const {markup} = renderDock({chatMode: false, input: ORDERED_INPUT, manifest: MANIFEST})

        expect(markup).toContain("Replace instructions")
        expect(markup).toContain("instructions.md")
        expect(markup).toContain("0123456789ab")
    })
})

/**
 * The same agent, same deployment, emits this arm too: `set`/`remove` stay in the catalog schema
 * even with ordered operations enabled, so the model picks per call. That is why one QA run showed
 * a full working diff while the next showed raw JSON. This arm must keep working untouched.
 */
const LEGACY_INPUT = {
    workflow_revision: {
        message: "Add the pineapple line.",
        delta: {
            set: {
                parameters: {
                    agent: {
                        instructions:
                            "You are a friendly hello-world agent. Greet the user warmly. I love pineapple pizza.",
                    },
                },
            },
        },
    },
}

describe("a legacy set delta, through the real classifier", () => {
    it("still renders the classified summary, and asks for it expanded", () => {
        const {markup} = renderDock({chatMode: true, input: LEGACY_INPUT})

        expect(markup).toContain("LEGACY_CHANGES_SUMMARY_OPEN")
        expect(markup).not.toContain("LEGACY_CHANGES_SUMMARY_COLLAPSED")
        // This arm does carry a commit message, unlike the ordered one.
        expect(markup).toContain("Commit message")
        expect(markup).toContain("Add the pineapple line.")
    })
})

describe("a delta neither arm can read", () => {
    it("keeps the exact payload rather than inventing a change", () => {
        const {markup} = renderDock({
            chatMode: true,
            input: {workflow_revision: {delta: {}}},
        })

        expect(markup).toContain("Payload")
        expect(markup).not.toContain("What&#x27;s changing")
    })
})
