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

const render = (props: {manifest?: unknown} = {}): string =>
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

describe("a malformed manifest", () => {
    it("is ignored rather than rendered as an empty block", () => {
        state.serverParams = {agent: {}}
        const rendered = render({manifest: {files: [], diffs: []}})

        expect(rendered).toContain("CHANGES_SUMMARY")
        expect(rendered).not.toContain("From your workspace")
    })
})
