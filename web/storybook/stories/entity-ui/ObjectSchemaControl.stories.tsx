import {useState} from "react"

import {
    CollapsibleObjectControl,
    ObjectSchemaControl,
    SchemaPropertyRenderer,
} from "@agenta/entity-ui/drill-in"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Tooltip as AntTooltip, Typography} from "antd"
import clsx from "clsx"

// ObjectSchemaControl — renders every property of an object inline through
// SchemaPropertyRenderer. antd surface: `Typography.Text` (labels + placeholders),
// `Tooltip` (the schema description on the header) and, in CollapsibleObjectControl, the
// `Button type="text"` caret toggle.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ObjectSchemaControl",
    component: ObjectSchemaControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Inline object renderer. antd `Typography.Text` → `<span>` + tokens, antd `Tooltip` → Radix `Tooltip`, antd `Button type="text"` → `@agenta/ui` `Button variant="ghost"`.',
            },
        },
    },
} satisfies Meta<typeof ObjectSchemaControl>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const LLM_CONFIG_SCHEMA = {
    type: "object",
    description: "Model settings applied to every run of this prompt.",
    properties: {
        model: {type: "string", enum: ["gpt-4o", "claude-sonnet"]},
        temperature: {type: "number", minimum: 0, maximum: 2},
        stream: {type: "boolean"},
        stop: {type: "string"},
    },
}

const LLM_CONFIG_VALUE = {model: "gpt-4o", temperature: 0.7, stream: true, stop: ""}

/** The main branch: header + tooltip + every property rendered inline. */
export const Inline: Story = {
    args: {
        schema: LLM_CONFIG_SCHEMA,
        label: "LLM configuration",
        value: LLM_CONFIG_VALUE,
        onChange: noop,
        path: ["llm_config"],
        SchemaPropertyRenderer,
    },
}

/** `showHeader={false}` — how the router calls it for top-level fields. */
export const NoHeader: Story = {
    args: {
        schema: LLM_CONFIG_SCHEMA,
        label: "LLM configuration",
        value: LLM_CONFIG_VALUE,
        onChange: noop,
        showHeader: false,
        SchemaPropertyRenderer,
    },
}

/** Schema declares nothing → the "No properties defined" placeholder. */
export const NoProperties: Story = {
    args: {
        schema: {type: "object", properties: {}},
        label: "Empty object",
        value: {},
        onChange: noop,
        SchemaPropertyRenderer,
    },
}

/** `ToolConfiguration` special-case: a raw JSON dump instead of per-property controls. */
export const ToolConfiguration: Story = {
    args: {
        schema: {type: "object", title: "ToolConfiguration", properties: {a: {type: "string"}}},
        label: "Tools",
        value: {tools: [{type: "function", function: {name: "search"}}]},
        onChange: noop,
        SchemaPropertyRenderer,
    },
}

/** No renderer injected (the circular-import guard) → JSON preview branch. */
export const NoRenderer: Story = {
    args: {
        schema: LLM_CONFIG_SCHEMA,
        label: "LLM configuration",
        value: LLM_CONFIG_VALUE,
        onChange: noop,
    },
}

/** Disabled: every dispatched leaf takes the disabled skin. */
export const DisabledInline: Story = {
    args: {
        schema: LLM_CONFIG_SCHEMA,
        label: "LLM configuration",
        value: LLM_CONFIG_VALUE,
        onChange: noop,
        disabled: true,
        SchemaPropertyRenderer,
    },
}

/** CollapsibleObjectControl — collapsed (caret-right) and expanded (caret-down). */
export const Collapsible: Story = {
    args: {schema: LLM_CONFIG_SCHEMA, label: "LLM configuration", value: {}, onChange: noop},
    render: () => (
        <div className="flex max-w-[560px] flex-col gap-6">
            <CollapsibleObjectControl
                schema={LLM_CONFIG_SCHEMA}
                label="Collapsed"
                value={LLM_CONFIG_VALUE}
                onChange={noop}
                SchemaPropertyRenderer={SchemaPropertyRenderer}
            />
            <CollapsibleObjectControl
                schema={LLM_CONFIG_SCHEMA}
                label="Expanded"
                value={LLM_CONFIG_VALUE}
                onChange={noop}
                defaultCollapsed={false}
                SchemaPropertyRenderer={SchemaPropertyRenderer}
            />
        </div>
    ),
}

// ---------------------------------------------------------------------------
// Parity: the migrated antd surfaces
// ---------------------------------------------------------------------------

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
        className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
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

/** Pre-migration "no properties" branch, verbatim. */
function AntdNoProperties({label}: {label: string}) {
    return (
        <div className={clsx("flex flex-col gap-1")}>
            <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
            <Typography.Text type="secondary" className="text-xs">
                No properties defined
            </Typography.Text>
        </div>
    )
}

/** Pre-migration collapsible toggle, verbatim (antd Tooltip + `Button type="text"`). */
function AntdCollapsibleToggle({label}: {label: string}) {
    const [isCollapsed, setIsCollapsed] = useState(true)
    // Same outer wrapper CollapsibleObjectControl renders, so the two crops are the
    // same box (without it the antd cell is the bare 89px button and the agenta cell the
    // full-width wrapper — a meaningless pair).
    return (
        <div className={clsx("flex flex-col gap-2")}>
            <AntTooltip title="Model settings applied to every run." placement="right">
                <AntButton
                    type="text"
                    className="flex items-center gap-1.5 px-0 h-auto"
                    onClick={() => setIsCollapsed((v) => !v)}
                >
                    <span className="text-[var(--ag-rgba-051729-45)] flex items-center">
                        {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                    </span>
                    <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
                </AntButton>
            </AntTooltip>
        </div>
    )
}

export const AntdVsAgenta: Story = {
    args: {schema: LLM_CONFIG_SCHEMA, label: "LLM configuration", value: {}, onChange: noop},
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="no properties"
                a={<AntdNoProperties label="Empty object" />}
                s={
                    <ObjectSchemaControl
                        schema={{type: "object", properties: {}}}
                        label="Empty object"
                        value={{}}
                        onChange={noop}
                        SchemaPropertyRenderer={SchemaPropertyRenderer}
                    />
                }
            />
            <Row
                label="header label"
                a={
                    <Typography.Text className="text-sm font-medium">
                        LLM configuration
                    </Typography.Text>
                }
                s={<span className="text-sm font-medium text-colorText">LLM configuration</span>}
            />
            <Row
                label="collapsible toggle (collapsed)"
                a={<AntdCollapsibleToggle label="Collapsed" />}
                s={
                    <CollapsibleObjectControl
                        schema={LLM_CONFIG_SCHEMA}
                        label="Collapsed"
                        description="Model settings applied to every run."
                        value={LLM_CONFIG_VALUE}
                        onChange={noop}
                        SchemaPropertyRenderer={SchemaPropertyRenderer}
                    />
                }
            />
        </div>
    ),
}
