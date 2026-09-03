import {DrillInUIProvider, ReferenceToolFormView} from "@agenta/entity-ui/drill-in"
import type {SubagentDetail, WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The detail panel for one saved subagent: the calling agent owns only the description.
// A subagent always runs the latest revision, so there is no version control here.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ReferenceToolFormView",
    component: ReferenceToolFormView,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "One saved subagent: an editable description over a read-only summary of the " +
                    "agent it points at. The instruction file clamps to four lines and expands " +
                    "into a fixed scrolling well rather than pushing the panel off screen.",
            },
        },
    },
} satisfies Meta<typeof ReferenceToolFormView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const TOOL = {
    type: "reference",
    ref_by: "variant",
    slug: "support-triage",
    name: "Support triage",
    description: "Summarize a support thread into three bullets.",
    input_schema: {type: "object", properties: {}},
}

/** Long enough to clamp, which is what makes the Show more link appear. */
const AGENTS_MD = [
    "You are a QA fixture agent. Run the migration browser matrix, compare legacy and modern",
    "rendering paths, and report failures with a reproduction link. Always start from the pinned",
    "fixture list. When a combination fails, capture the console output, the rendered screenshot,",
    "and the diff against the last known-good run before you report it.",
    "",
    "Never retry a failing combination more than twice. A third failure is a real defect and it",
    "belongs in the report, not in another retry.",
].join("\n")

const DETAIL: SubagentDetail = {
    workflowId: "01a04000-0000-7000-8000-000000000001",
    name: "Support triage",
    description: "Reads an incoming support ticket and names the team that owns it.",
    model: "claude-sonnet-4-5",
    provider: "anthropic",
    integrations: [
        {key: "github", name: "GitHub", permission: "Allow all"},
        {key: "linear", name: "Linear", permission: "Ask for write and delete"},
    ],
    skills: ["Browser matrix run", "Visual diff", "Repro reducer"],
    instructions: {fileName: "AGENTS.md", text: AGENTS_MD, wordCount: 2140},
}

/** A bridge that resolves one subagent. Only the members this panel touches are real. */
const bridgeWith = (detail: SubagentDetail | null) =>
    ({
        enabled: true,
        workflows: [],
        workflowsLoading: false,
        useSubagentDetail: () => ({detail, loading: false}),
        agentHref: (id: string) => `/agents/${id}`,
    }) as unknown as WorkflowReferenceBridge

const Frame = (bridge: WorkflowReferenceBridge | undefined, children: React.ReactNode) => (
    <div data-vrt-subject className="w-[520px]">
        <DrillInUIProvider components={bridge ? {workflowReference: bridge} : {}}>
            {children}
        </DrillInUIProvider>
    </div>
)

/** The full panel: identity, the one editable field, and the read-only configuration. */
export const Default: Story = {
    args: {value: TOOL, onChange: noop},
    render: (args) => Frame(bridgeWith(DETAIL), <ReferenceToolFormView {...args} value={TOOL} />),
}

/** An agent with nothing configured. Each row says so rather than rendering an empty gap. */
export const NothingConfigured: Story = {
    args: {value: TOOL, onChange: noop},
    render: (args) =>
        Frame(
            bridgeWith({
                ...DETAIL,
                model: undefined,
                integrations: [],
                skills: [],
                instructions: undefined,
            }),
            <ReferenceToolFormView {...args} value={TOOL} />,
        ),
}

/** No host bridge at all, so nothing resolves. The description still edits: it is local. */
export const WithoutBridge: Story = {
    args: {value: TOOL, onChange: noop},
    render: (args) => Frame(undefined, <ReferenceToolFormView {...args} value={TOOL} />),
}

/** Read-only revision: the description cannot be edited either. */
export const Disabled: Story = {
    args: {value: TOOL, onChange: noop, disabled: true},
    render: (args) =>
        Frame(bridgeWith(DETAIL), <ReferenceToolFormView {...args} value={TOOL} disabled />),
}
