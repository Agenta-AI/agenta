/**
 * The approval dock's generic card, specifically the frozen workspace content it must show.
 *
 * The manifest is a SIBLING of the tool input, never inside it, so a card that renders only the
 * payload shows an `@ag.file` path and nothing else while Approve stays live. Build mode is the
 * default (`chatPanelMaximizedAtom` starts false), so that is the card most approvals get.
 *
 * The presentational shells (antd, HeightCollapse, icons) are mocked: this test is about which
 * branch renders the manifest, not about how the chrome looks.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    chatMode: false,
    serverParams: null as unknown,
}))

vi.mock("jotai", () => ({
    atom: (init: unknown) => ({init}),
    // The dock reads the layout atom; the commit body reads the workflow molecule's selector,
    // which the mock below stamps so the two are told apart.
    useAtomValue: (target: unknown) =>
        target && typeof target === "object" && "serverConfigFor" in target
            ? state.serverParams
            : state.chatMode,
}))

vi.mock("@agenta/ui", () => ({
    HeightCollapse: ({children}: {children?: unknown}) => <div>{children}</div>,
}))

vi.mock("@phosphor-icons/react", () => ({
    ArrowSquareOut: () => <i />,
    CaretDown: () => <i />,
    CaretRight: () => <i />,
    ChatText: () => <i />,
    ShieldCheck: () => <i />,
}))

vi.mock("antd", () => {
    const Button = ({children}: {children?: unknown}) => <button type="button">{children}</button>
    const DropdownButton = ({children}: {children?: unknown}) => <div>{children}</div>
    const TextArea = () => <textarea />
    const Text = ({children}: {children?: unknown}) => <span>{children}</span>
    return {
        Button,
        Dropdown: Object.assign(() => null, {Button: DropdownButton}),
        Input: Object.assign(() => null, {TextArea}),
        Switch: () => <input type="checkbox" />,
        Typography: {Text},
    }
})

vi.mock("@/oss/hooks/useAlwaysAllowTool", () => ({
    useAlwaysAllowTool: () => ({infoFor: () => null, grant: () => undefined}),
}))

vi.mock("../assets/constants", () => ({isAgentChatSteerEnabled: () => false}))

vi.mock("@agenta/entities/workflow", () => ({
    workflowMolecule: {selectors: {serverConfiguration: (id: string) => ({serverConfigFor: id})}},
}))

vi.mock("@agenta/entities/workflow/commitDiff", () => ({
    classifyRevisionDeltaChanges: () => ({sections: [{id: "instructions", title: "Instructions"}]}),
    parseGatewayToolName: (raw: string) => ({label: raw, raw}),
}))

// Echoes the sections it was given, so a test can tell a real classified change from an empty
// shell. Its own `compact` prop means embedded rendering and both layouts set it, so it cannot
// discriminate the body layout. The two-pane pane header does that instead.
vi.mock("@agenta/entity-ui/modals", () => ({
    AgentChangesSummary: ({sections}: {sections: {id: string; title: string}[]}) => (
        <div>
            CHANGES_SUMMARY
            {sections.map((section) => (
                <span key={section.id}>{section.title}</span>
            ))}
        </div>
    ),
}))

const {default: ApprovalDock} = await import("./ApprovalDock")

const MANIFEST = {
    version: 1,
    files: [
        {
            relativePath: "skills/pdf.md",
            requestedPath: ".agenta-imports/skills/pdf.md",
            bytes: 24,
            digest: "abcdef0123456789",
            executableBit: false,
        },
    ],
    diffs: [
        {
            targetField: "instructions",
            baseRevisionId: "rev-1",
            oldBytes: 10,
            newBytes: 24,
            diff: "@@ -1 +1 @@\n-be terse\n+be brief",
            addedLines: 1,
            removedLines: 1,
            diffTruncated: false,
        },
    ],
    totalBytes: 24,
    contentDigest: "0123456789abcdef",
}

const APPROVAL = {
    approvalId: "approval-1",
    toolName: "commit_revision",
    // What the model actually wrote: a marker, not the bytes. On its own this is the "byte count
    // and a path" card the import contract forbids.
    input: {
        workflow_revision: {
            base_revision_id: "rev-1",
            delta: {
                operations: [
                    {operation: "set", target: ["instructions"], value: {"@ag.file": "pdf.md"}},
                ],
            },
        },
    },
    manifest: MANIFEST,
}

// The common case that the UI E2E caught: the agent rewrites a field from its own text, so there
// is no file import and therefore no manifest at all.
const TEXT_ONLY_APPROVAL = {
    approvalId: "approval-2",
    toolName: "commit_revision",
    input: {
        description: "Rewriting the greeting so it says you are a QA test agent.",
        workflow_revision: {
            base_revision_id: "rev-1",
            message: "Update the greeting sentence.",
            delta: {
                operations: [
                    {operation: "set", target: ["instructions"], value: "Greet the user warmly."},
                ],
            },
        },
    },
}

const render = (approval: unknown = APPROVAL): string =>
    renderToStaticMarkup(
        <ApprovalDock
            approvals={[approval] as never}
            onApprovalResponse={() => undefined}
            entityId="revision-1"
        />,
    )

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1

beforeEach(() => {
    state.chatMode = false
    state.serverParams = null
})

describe("Build mode", () => {
    it("shows the frozen content and diff, with the exact payload still reachable", () => {
        const rendered = render()

        expect(rendered).toContain("skills/pdf.md")
        expect(rendered).toContain("0123456789ab")
        expect(rendered).toContain("Payload")
        // The manifest owns a file-backed operation, so the change is stated once, not twice.
        expect(occurrences(rendered, "Replace instructions")).toBe(1)
    })

    it("keeps showing it when the host has no revision to diff against", () => {
        const rendered = renderToStaticMarkup(
            <ApprovalDock approvals={[APPROVAL] as never} onApprovalResponse={() => undefined} />,
        )

        expect(rendered).toContain("Replace instructions")
        expect(rendered).toContain("skills/pdf.md")
    })

    it("offers Approve only once the content is on screen", () => {
        // The pairing is the point: an enabled Approve with no manifest is an uninformed approval.
        const rendered = render()

        expect(rendered).toContain("Approve")
        expect(rendered).toContain("From your workspace")
    })

    it("renders no manifest block when the gate carries none", () => {
        const rendered = render({...APPROVAL, manifest: undefined})

        expect(rendered).not.toContain("From your workspace (")
        // With no manifest the operation is all we can state, so it is stated here instead.
        expect(rendered).toContain("Replace instructions")
    })

    it("ignores a malformed manifest rather than rendering an empty block", () => {
        const rendered = render({...APPROVAL, manifest: {files: [], diffs: []}})

        expect(rendered).not.toContain("From your workspace")
    })
})

describe("Build mode, commit with a committed base to diff against", () => {
    beforeEach(() => {
        state.serverParams = {agent: {}}
    })

    it("renders the change and the labelled intent, not a raw JSON blob", () => {
        // The regression the UI E2E caught. Build is the default mode. A text-only commit carries
        // no manifest, so before this the whole card body was the payload block.
        const rendered = render(TEXT_ONLY_APPROVAL)

        expect(rendered).toContain("CHANGES_SUMMARY")
        expect(rendered).toContain("Instructions")
        // The pane header belongs to the two-pane layout only, so its absence pins the compact one.
        expect(rendered).not.toContain("Save a new version of this agent")
        expect(rendered).toContain("What the agent says it is doing")
        expect(rendered).toContain("Rewriting the greeting so it says you are a QA test agent.")
        expect(rendered).toContain("Commit message")
        expect(rendered).toContain("Update the greeting sentence.")
        expect(rendered).not.toContain("The agent wants to run this tool before it can keep going.")
    })

    it("humanizes the ask — the raw wire name stays out of the card body", () => {
        // Build reads like Chat: raw wire names live in tooltips, never as a header row.
        const rendered = render(TEXT_ONLY_APPROVAL)

        expect(rendered).not.toContain("commit_revision")
    })

    it("still shows the imported content when the commit imports files", () => {
        const rendered = render()

        expect(rendered).toContain("CHANGES_SUMMARY")
        expect(occurrences(rendered, "From your workspace")).toBe(1)
        expect(occurrences(rendered, "Replace instructions")).toBe(1)
    })
})

describe("Chat mode", () => {
    beforeEach(() => {
        state.chatMode = true
        state.serverParams = {agent: {}}
    })

    it("renders the manifest exactly once, through the specialized body", () => {
        const rendered = render()

        // Two panes, not the compact stack, and no second copy from the generic card.
        expect(rendered).toContain("CHANGES_SUMMARY")
        expect(rendered).toContain("Save a new version of this agent")
        expect(occurrences(rendered, "From your workspace")).toBe(1)
        expect(occurrences(rendered, "Replace instructions")).toBe(1)
        expect(occurrences(rendered, "0123456789ab")).toBe(1)
    })

    it("renders the intent and the message once each, in the two-pane shape", () => {
        const rendered = render(TEXT_ONLY_APPROVAL)

        expect(occurrences(rendered, "What the agent says it is doing")).toBe(1)
        expect(occurrences(rendered, "Commit message")).toBe(1)
        expect(rendered).toContain("Save a new version of this agent")
    })

    it("still renders it once when the delta cannot be previewed", () => {
        state.serverParams = null
        const rendered = render()

        expect(rendered).not.toContain("CHANGES_SUMMARY")
        expect(occurrences(rendered, "From your workspace")).toBe(1)
    })
})
