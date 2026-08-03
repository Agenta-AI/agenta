import type {ReactNode} from "react"

import {RailField} from "@agenta/entity-ui/drawers/shared"
import {ReferenceToolFormView, SchemaTree} from "@agenta/entity-ui/drill-in"
import {ConfigAccordionSection, CopyButton} from "@agenta/ui/components/presentational"
import {GitBranch, Info, TreeStructure} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input as AntInput} from "antd"

// ReferenceToolFormView — the detail view for a `type:"reference"` workflow tool (#4860):
// exposed name, description, the resolved input schema, and the "Reference by" axis.
// Storybook mounts it without a `workflowReference` bridge, so the read-only binding
// summary renders (the editable axis needs the host's bridge).
//
// The antd half replays the pre-migration body verbatim from feat/storybook-data-seam; the
// shared chrome (ConfigAccordionSection / SchemaTree / CopyButton / RailField) is the SAME
// component in both halves, so the diff isolates the migrated leaves.
//
// antd swaps: `Input.TextArea autoSize` → `AutosizeTextarea` (`@agenta/ui`);
// `Spin size="small"` → `Spinner size="small"` (the environment picker's loading slot,
// only reachable with the bridge injected).
const meta = {
    title: "@agenta/entity-ui/DrillIn/ReferenceToolFormView",
    component: ReferenceToolFormView,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Edit counterpart of the WorkflowReferenceSelector: exposed tool name, editable description, read-only input schema, and the reference binding.",
            },
        },
    },
} satisfies Meta<typeof ReferenceToolFormView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const INPUT_SCHEMA = {
    type: "object",
    properties: {
        thread: {type: "string", description: "The support thread to summarize"},
        max_bullets: {type: "integer"},
    },
    required: ["thread"],
}

const PINNED_TOOL = {
    type: "reference",
    ref_by: "variant",
    slug: "summarizer",
    version: "3",
    description: "Summarize a support thread into three bullets",
    input_schema: INPUT_SCHEMA,
}

const DEPLOYED_TOOL = {
    type: "reference",
    ref_by: "environment",
    slug: "summarizer",
    environment: "production",
    description: "",
    input_schema: null,
}

/** Pre-migration body, verbatim (antd baseline). */
const AntdBody = ({
    slug,
    description,
    schema,
    binding,
}: {
    slug: string
    description: string
    schema: Record<string, unknown> | null
    binding: string
}) => (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <div className="flex flex-col gap-4">
            <ConfigAccordionSection
                size="compact"
                collapsible={false}
                icon={<Info size={15} />}
                title="Details"
            >
                <RailField label="Exposed as" align="center">
                    <div className="flex w-fit max-w-full items-center gap-1 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] py-0.5 pl-2.5 pr-1 font-mono text-xs text-[var(--ag-colorText)]">
                        <span className="truncate">{slug}</span>
                        <CopyButton text={slug} buttonText={null} icon variant="ghost" />
                    </div>
                </RailField>

                <RailField label="Description">
                    <AntInput.TextArea
                        value={description}
                        autoSize={{minRows: 2, maxRows: 6}}
                        placeholder="What this tool does and when the agent should call it"
                        readOnly
                    />
                </RailField>
            </ConfigAccordionSection>

            <ConfigAccordionSection
                size="compact"
                icon={<TreeStructure size={15} />}
                title="Schema"
                summary={`Inputs · ${schema?.properties ? Object.keys(schema.properties).length : 0}`}
                summaryCollapsedOnly
            >
                <div className="max-h-[320px] max-w-prose overflow-y-auto overscroll-contain">
                    <SchemaTree schema={schema} emptyText="No declared inputs" />
                </div>
            </ConfigAccordionSection>

            <ConfigAccordionSection
                size="compact"
                noDivider
                icon={<GitBranch size={15} />}
                title="Reference by"
                summary={binding}
                summaryCollapsedOnly
            >
                <p className="m-0 text-xs text-[var(--ag-colorTextSecondary)]">{binding}</p>
            </ConfigAccordionSection>
        </div>
    </div>
)

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[8rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
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

export const AntdVsAgenta: Story = {
    args: {value: PINNED_TOOL, onChange: noop},
    render: () => (
        <div className="flex max-w-[1200px] flex-col">
            <Row
                label="pinned revision"
                a={
                    <AntdBody
                        slug="summarizer"
                        description="Summarize a support thread into three bullets"
                        schema={INPUT_SCHEMA}
                        binding="Pinned to v3"
                    />
                }
                s={<ReferenceToolFormView value={PINNED_TOOL} onChange={noop} />}
            />
            <Row
                label="deployed env"
                a={
                    <AntdBody
                        slug="summarizer"
                        description=""
                        schema={null}
                        binding="Deployed in production"
                    />
                }
                s={<ReferenceToolFormView value={DEPLOYED_TOOL} onChange={noop} />}
            />
        </div>
    ),
}

/** Read-only (committed revision): the description textarea takes the disabled skin. */
export const Disabled: Story = {
    args: {value: PINNED_TOOL, onChange: noop, disabled: true},
    render: () => (
        <div className="max-w-[560px]">
            <ReferenceToolFormView value={PINNED_TOOL} onChange={noop} disabled />
        </div>
    ),
}
