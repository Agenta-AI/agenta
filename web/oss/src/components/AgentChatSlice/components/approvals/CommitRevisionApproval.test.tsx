/**
 * The `commit_revision` approval body, specifically its imported-content path.
 *
 * The card has two shapes: a two-pane preview when the delta can be classified against the
 * committed base, and the raw payload when it cannot. The workspace content a commit imports is
 * what the authorization actually binds, so it must render in BOTH — losing it on the fallback
 * path would ask a human to approve file content they were never shown.
 *
 * The entity-state dependencies are mocked: this test is about which branch renders what, not
 * about the workflow molecule.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    serverParams: null as unknown,
    sections: [{title: "instructions"}] as unknown,
}))

vi.mock("jotai", () => ({useAtomValue: () => state.serverParams}))

vi.mock("@agenta/entities/workflow", () => ({
    workflowMolecule: {selectors: {serverConfiguration: (id: string) => ({id})}},
}))

vi.mock("@agenta/entities/workflow/commitDiff", () => ({
    classifyRevisionDeltaChanges: () => ({sections: state.sections}),
    // Unused here, but `assets/toolDisplay` (the call-description reader) imports it.
    parseGatewayToolName: (raw: string) => ({label: raw, raw}),
}))

vi.mock("@agenta/entity-ui/modals", () => ({
    AgentChangesSummary: () => <div>CHANGES_SUMMARY</div>,
}))

const {default: CommitRevisionApproval} = await import("./CommitRevisionApproval")

const MANIFEST = {
    files: [
        {
            relativePath: "instructions.md",
            requestedPath: ".agenta-imports/instructions.md",
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
            oldLines: 1,
            newLines: 1,
            oldDigest: "old",
            newDigest: "new",
            diff: "@@ -1 +1 @@\n-be terse\n+be brief",
            addedLines: 1,
            removedLines: 1,
            diffTruncated: false,
            diffCoarse: false,
        },
    ],
    totalBytes: 24,
    contentDigest: "0123456789abcdef",
}

const INPUT = {workflow_revision: {base_revision_id: "rev-1", delta: {operations: []}}}

// Production shape: the per-call `description` sits at the TOP level, beside `workflow_revision`,
// and says something different from the commit message (read-config.md section 12.2).
const DESCRIBED_INPUT = {
    description: "Adding the pdf-tools skill you asked for.",
    workflow_revision: {
        base_revision_id: "rev-1",
        message: "Add the pdf-tools skill.",
        delta: {operations: []},
    },
}

const render = (props: {manifest?: unknown; input?: unknown} = {}): string =>
    renderToStaticMarkup(
        <CommitRevisionApproval
            input={INPUT}
            entityId="revision-1"
            fallback={<div>RAW_PAYLOAD</div>}
            {...props}
        />,
    ).replace(/<[^>]*>/g, " ")

beforeEach(() => {
    state.serverParams = null
    state.sections = [{title: "instructions"}]
})

describe("with a committed base to preview against", () => {
    beforeEach(() => {
        state.serverParams = {agent: {}}
    })

    it("renders the changes summary and the imported content together", () => {
        const rendered = render({manifest: MANIFEST})

        expect(rendered).toContain("CHANGES_SUMMARY")
        expect(rendered).toContain("Replace instructions")
        expect(rendered).toContain("instructions.md")
        expect(rendered).not.toContain("RAW_PAYLOAD")
    })

    it("renders the summary alone when the commit imports nothing", () => {
        const rendered = render()

        expect(rendered).toContain("CHANGES_SUMMARY")
        expect(rendered).not.toContain("From your workspace")
        expect(rendered).not.toContain("Replace instructions")
    })
})

describe("with no previewable base", () => {
    it("still renders the imported content beside the raw payload", () => {
        // The fallback is the branch most at risk of dropping it, and it is exactly the content
        // the approval binds.
        const rendered = render({manifest: MANIFEST})

        expect(rendered).toContain("RAW_PAYLOAD")
        expect(rendered).toContain("Replace instructions")
        expect(rendered).toContain("instructions.md")
        expect(rendered).not.toContain("CHANGES_SUMMARY")
    })

    it("renders only the raw payload when the commit imports nothing", () => {
        const rendered = render()

        expect(rendered).toContain("RAW_PAYLOAD")
        expect(rendered).not.toContain("From your workspace")
    })
})

describe("the agent's stated intent", () => {
    it("renders beside the commit message, each labelled as what it is", () => {
        // The two texts are different things: the intent describes the CALL and is never
        // persisted, the message is saved on the revision. Showing one as the other misreports
        // what the human is approving.
        state.serverParams = {agent: {}}
        const rendered = render({input: DESCRIBED_INPUT})

        expect(rendered).toContain("What the agent says it is doing")
        expect(rendered).toContain("Adding the pdf-tools skill you asked for.")
        expect(rendered).toContain("Commit message")
        expect(rendered).toContain("Add the pdf-tools skill.")
    })

    it("renders on the fallback branch too, where the preview is hidden", () => {
        const rendered = render({input: DESCRIBED_INPUT})

        expect(rendered).toContain("RAW_PAYLOAD")
        expect(rendered).toContain("What the agent says it is doing")
        expect(rendered).toContain("Adding the pdf-tools skill you asked for.")
    })

    it("marks a description cut at the catalog's 500-character cap", () => {
        state.serverParams = {agent: {}}
        const description = `${"x".repeat(500)}TAIL`
        const rendered = render({
            input: {...DESCRIBED_INPUT, description},
        })

        expect(rendered).toContain("(shortened)")
        expect(rendered).not.toContain("TAIL")
    })

    it("is absent when the agent wrote none", () => {
        state.serverParams = {agent: {}}
        const rendered = render()

        expect(rendered).not.toContain("What the agent says it is doing")
    })
})

describe("a malformed manifest", () => {
    it("is ignored rather than rendered as an empty block", () => {
        state.serverParams = {agent: {}}
        const rendered = render({manifest: {files: [], diffs: []}})

        expect(rendered).toContain("CHANGES_SUMMARY")
        expect(rendered).not.toContain("From your workspace")
    })
})
