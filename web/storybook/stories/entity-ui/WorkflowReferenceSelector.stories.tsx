import {useState} from "react"

import type {
    WorkflowReferenceBridge,
    WorkflowReferenceType,
    WorkflowReferenceUI,
} from "@agenta/ui/drill-in"
import {
    AutosizeTextarea,
    Badge,
    Button,
    EmptyState,
    InputAffix,
    Segmented,
    Spinner,
} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Empty as AntEmpty,
    Input as AntInput,
    Segmented as AntSegmented,
    Spin,
    Tag as AntTag,
} from "antd"

// Not exported from `@agenta/entity-ui/drill-in` (AgentTemplateControl is its only consumer), so
// the story imports the source directly — the relative-import convention used by the @agenta/ui
// primitive stories for unbarrelled components.
import {WorkflowReferenceSelector} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/WorkflowReferenceSelector"

// WorkflowReferenceSelector — the master/detail drawer for referencing a workflow as an agent
// tool. Migration: antd `Tag` → `Badge`, antd `Input prefix allowClear` → `InputAffix`,
// antd `Input.TextArea autoSize` → `AutosizeTextarea`, antd `Segmented` → `@agenta/ui` `Segmented`,
// antd `Spin` → `Spinner`, antd `Empty PRESENTED_IMAGE_SIMPLE` → `EmptyState image="simple"`,
// antd `Skeleton` → `@agenta/ui` `Skeleton`.
//
// The drawer portals to `body`, so the state stories are SHOWCASES; `AntdVsAgenta` pairs the
// swapped in-drawer pieces inline against their pre-migration markup
// (`git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/WorkflowReferenceSelector.tsx`).
const meta = {
    title: "@agenta/entity-ui/DrillIn/WorkflowReferenceSelector",
    component: WorkflowReferenceSelector,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Two-panel drawer: a searchable, type-badged workflow rail on the left; the selected workflow's description, exposed tool name, schema and reference axis on the right.",
            },
        },
    },
} satisfies Meta<typeof WorkflowReferenceSelector>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const WORKFLOWS: WorkflowReferenceUI[] = [
    {
        id: "wf-1",
        slug: "summarize_ticket",
        name: "Summarize ticket",
        description: "Condense a support ticket into three bullets.",
        type: "completion",
    },
    {id: "wf-2", slug: "chat_agent", name: "Chat agent", type: "chat"},
    {id: "wf-3", slug: "triage_agent", name: "Triage agent", type: "agent"},
    {id: "wf-4", slug: "exact_match", name: "Exact match", type: "evaluator"},
    {id: "wf-5", slug: "custom_scorer", name: "Custom scorer", type: "custom"},
]

const TYPE_BY_SLUG: Record<string, WorkflowReferenceType | undefined> = Object.fromEntries(
    WORKFLOWS.map((w) => [w.slug, w.type]),
)

const makeBridge = (over: Partial<WorkflowReferenceBridge> = {}): WorkflowReferenceBridge => ({
    enabled: true,
    workflows: WORKFLOWS,
    workflowsLoading: false,
    resolveInputSchema: async () => ({
        type: "object",
        properties: {ticket: {type: "string", title: "Ticket"}},
    }),
    resolveOutputSchema: async () => null,
    useWorkflowRevisions: () => ({revisions: [], isLoading: false}),
    useWorkflowEnvironments: () => ({environments: [], isLoading: false}),
    useWorkflowTypes: () => ({typeBySlug: TYPE_BY_SLUG, loading: false}),
    ...over,
})

const DrawerDemo = ({
    bridge,
    workflows,
}: {
    bridge: WorkflowReferenceBridge
    workflows?: WorkflowReferenceUI[]
}) => {
    const [open, setOpen] = useState(true)
    return (
        <div className="p-4">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Open reference picker
            </Button>
            <WorkflowReferenceSelector
                open={open}
                onClose={() => setOpen(false)}
                workflows={workflows ?? WORKFLOWS}
                bridge={bridge}
                onSelect={noop}
            />
        </div>
    )
}

/** Resting state — the rail lists every workflow, the detail pane shows the "pick one" hint. */
export const Default: Story = {
    args: {open: true, onClose: noop, workflows: WORKFLOWS, bridge: makeBridge(), onSelect: noop},
    render: () => <DrawerDemo bridge={makeBridge()} />,
}

/** Loading — the rail shows the Spinner while the workflow list resolves. */
export const Loading: Story = {
    args: Default.args,
    render: () => (
        <DrawerDemo bridge={makeBridge({workflowsLoading: true, workflows: []})} workflows={[]} />
    ),
}

/** No referenceable workflows — the rail's EmptyState. */
export const EmptyList: Story = {
    args: Default.args,
    render: () => (
        <DrawerDemo
            bridge={makeBridge({
                workflows: [],
                useWorkflowTypes: () => ({typeBySlug: {}, loading: false}),
            })}
            workflows={[]}
        />
    ),
}

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

const TYPE_BADGE_CLASS = "max-w-[140px] truncate px-1.5 py-0 text-[10px] leading-[18px]"
const FILTER_OPTIONS = [
    {label: "All", value: "all"},
    {label: "Completion", value: "completion"},
    {label: "Chat", value: "chat"},
    {label: "Agent", value: "agent"},
]

export const AntdVsAgenta: Story = {
    args: Default.args,
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="type badge"
                expected="light only: cyan/gold/green TEXT is one-to-two steps down antd's own ramp — the documented WCAG-AA deviation in palette.ts `presetTag` (cyan 3.39→5.82, gold 2.76→6.53, green 3.37→5.44 on the paired bg). Backgrounds and geometry match exactly; dark passes."
                a={
                    <div className="flex items-center gap-1.5">
                        <AntTag
                            color="purple"
                            bordered={false}
                            className={`m-0 ${TYPE_BADGE_CLASS}`}
                        >
                            agent
                        </AntTag>
                        <AntTag color="blue" bordered={false} className={`m-0 ${TYPE_BADGE_CLASS}`}>
                            chat
                        </AntTag>
                        <AntTag color="cyan" bordered={false} className={`m-0 ${TYPE_BADGE_CLASS}`}>
                            completion
                        </AntTag>
                        <AntTag color="gold" bordered={false} className={`m-0 ${TYPE_BADGE_CLASS}`}>
                            custom
                        </AntTag>
                        <AntTag
                            color="green"
                            bordered={false}
                            className={`m-0 ${TYPE_BADGE_CLASS}`}
                        >
                            evaluator
                        </AntTag>
                    </div>
                }
                s={
                    <div className="flex items-center gap-1.5">
                        <Badge variant="purple" className={TYPE_BADGE_CLASS}>
                            agent
                        </Badge>
                        <Badge variant="blue" className={TYPE_BADGE_CLASS}>
                            chat
                        </Badge>
                        <Badge variant="cyan" className={TYPE_BADGE_CLASS}>
                            completion
                        </Badge>
                        <Badge variant="gold" className={TYPE_BADGE_CLASS}>
                            custom
                        </Badge>
                        <Badge variant="green" className={TYPE_BADGE_CLASS}>
                            evaluator
                        </Badge>
                    </div>
                }
            />
            <Row
                label="rail search input"
                a={
                    <AntInput
                        prefix={
                            <MagnifyingGlass
                                size={14}
                                className="text-[var(--ag-colorTextTertiary)]"
                            />
                        }
                        placeholder="Search workflows"
                        value="triage"
                        allowClear
                    />
                }
                s={
                    <InputAffix
                        prefix={
                            <MagnifyingGlass
                                size={14}
                                className="text-[var(--ag-colorTextTertiary)]"
                            />
                        }
                        placeholder="Search workflows"
                        aria-label="Search workflows"
                        value="triage"
                        onValueChange={noop}
                        allowClear
                    />
                }
            />
            <Row
                label="type filter chips"
                a={<AntSegmented className="w-max" value="all" options={FILTER_OPTIONS} />}
                s={
                    <Segmented
                        className="w-max"
                        value="all"
                        options={FILTER_OPTIONS}
                        aria-label="Filter workflows by type"
                    />
                }
            />
            <Row
                label="rail loading"
                a={
                    <div className="flex justify-center py-6">
                        <Spin size="small" />
                    </div>
                }
                s={
                    <div className="flex justify-center py-6">
                        <Spinner size="small" />
                    </div>
                }
            />
            <Row
                label="rail empty"
                a={
                    <AntEmpty
                        image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                                No workflows to reference
                            </span>
                        }
                    />
                }
                s={
                    <EmptyState
                        image="simple"
                        description={
                            <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                                No workflows to reference
                            </span>
                        }
                    />
                }
            />
            <Row
                label="description textarea"
                a={
                    <AntInput.TextArea
                        className="max-w-prose"
                        value="Condense a support ticket into three bullets."
                        autoSize={{minRows: 2, maxRows: 6}}
                        placeholder="What this tool does and when the agent should call it"
                    />
                }
                s={
                    <AutosizeTextarea
                        className="max-w-prose"
                        value="Condense a support ticket into three bullets."
                        onChange={noop}
                        autoSize={{minRows: 2, maxRows: 6}}
                        aria-label="Tool description"
                        placeholder="What this tool does and when the agent should call it"
                    />
                }
            />
        </div>
    ),
}
