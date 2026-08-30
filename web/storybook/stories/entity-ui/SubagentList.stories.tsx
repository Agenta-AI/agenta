import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export the subagent list.
import {SubagentList} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ToolManagementList"

// A subagent is saved as a workflow reference (`{type: "reference"}`), so the wire format keeps the
// old name and only the surface says "subagent". These entries are the shapes `describeTool` reads.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SubagentList",
    component: SubagentList,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The Subagents section body: the published workflows this agent can call, " +
                    "as a flat row list. Each row's subtitle names the referenced workflow and " +
                    "how it is pinned, either to a version or to an environment. The list draws " +
                    "no sub-header and no add button: the accordion section header owns the " +
                    "title, the count, and the plus.",
            },
        },
    },
} satisfies Meta<typeof SubagentList>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/**
 * Pinned to one variant, optionally at a fixed version. `ref_by` is "variant" or "environment"
 * on the wire, never "version" — the version is a field, not an axis. See the writer in
 * `useAgentTools.handleAddWorkflowReference` and `ReferenceToolFormView`.
 */
const variantRef = (
    name: string,
    slug: string,
    variant: string,
    version: string,
    description?: string,
) => ({
    type: "reference",
    name,
    slug,
    ref_by: "variant",
    variant,
    version,
    description,
})

/** Pinned to an environment, so the agent follows whatever is deployed there. */
const environmentRef = (name: string, slug: string, environment: string) => ({
    type: "reference",
    name,
    slug,
    ref_by: "environment",
    environment,
})

const ENTRIES = [
    variantRef(
        "triage_ticket",
        "support-triage",
        "01a04000-0000-7000-8000-000000000001",
        "3",
        "Reads a support ticket and returns its severity and owning team.",
    ),
    variantRef(
        "summarize_thread",
        "thread-summarizer",
        "01a04000-0000-7000-8000-000000000002",
        "12",
    ),
    environmentRef("draft_reply", "reply-drafter", "production"),
].map((item, index) => ({item, index}))

const listArgs = (entries: typeof ENTRIES) => ({
    entries,
    openEdit: noop,
    removeItem: noop,
    closeEditor: noop,
    emptyAdd: <a>add a subagent</a>,
})

// Showcase, not an antd parity pair. `data-vrt-subject` is the harness's readiness marker.
const Frame = (children: React.ReactNode) => (
    <div data-vrt-subject className="w-[520px]">
        {children}
    </div>
)

/** Both axes side by side, so a variant row and an environment row can be read against each other. */
export const RowStates: Story = {
    args: listArgs(ENTRIES),
    render: (args) => Frame(<SubagentList {...args} />),
}

/** One row, which is the common case for an agent that delegates a single job. */
export const SingleRow: Story = {
    args: listArgs(ENTRIES.slice(0, 1)),
    render: (args) => Frame(<SubagentList {...args} />),
}

/**
 * No subagents yet. The body is one line that carries the add link, because the section header's
 * plus is easy to miss on a section the reader has just opened for the first time.
 */
export const Empty: Story = {
    args: listArgs([]),
    render: (args) => Frame(<SubagentList {...args} />),
}

/**
 * Read-only revision. Rows lose the chevron, the Remove button and the tab stop, and the empty
 * state disappears rather than offering an add the revision cannot do.
 */
export const ReadOnly: Story = {
    args: {...listArgs(ENTRIES), disabled: true},
    render: (args) => Frame(<SubagentList {...args} />),
}
