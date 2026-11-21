import type {ReactNode} from "react"

import {ToolItemControl} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ToolItemControl — one tools[] entry: a header (function / builtin / gateway / workflow
// reference) over the JSON editor. Storybook renders it without a `SharedEditor` injection,
// so it takes the documented textarea fallback branch.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ToolItemControl",
    component: ToolItemControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Schema-driven control for one tool definition. Header variants: custom function, provider builtin, gateway (integration/action/connection) and workflow reference.",
            },
        },
    },
} satisfies Meta<typeof ToolItemControl>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const FUNCTION_TOOL = {
    type: "function",
    function: {
        name: "get_weather",
        description: "Get current weather",
        parameters: {
            type: "object",
            properties: {location: {type: "string", description: "City name"}},
            required: ["location"],
            additionalProperties: false,
        },
    },
}

const BUILTIN_TOOL = {type: "web_search_preview"}

const REFERENCE_TOOL = {
    type: "reference",
    ref_by: "variant",
    slug: "summarizer",
    name: "summarize_thread",
    description: "Summarize a support thread into three bullets",
    input_schema: {type: "object", properties: {thread: {type: "string"}}},
}

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

/** The three header shapes, with the hover-only action rail forced visible. */
export const Variants: Story = {
    args: {value: FUNCTION_TOOL},
    render: () => (
        // `[&_.invisible]:!visible` reveals the `group-hover/tool` action rail.
        <div className="flex max-w-[640px] flex-col [&_.invisible]:!visible">
            <Row label="function tool">
                <ToolItemControl
                    value={FUNCTION_TOOL}
                    onDelete={noop}
                    onDuplicate={noop}
                    onChange={noop}
                />
            </Row>
            <Row label="builtin tool">
                <ToolItemControl
                    value={BUILTIN_TOOL}
                    onDelete={noop}
                    onDuplicate={noop}
                    onChange={noop}
                />
            </Row>
            <Row label="workflow reference">
                <ToolItemControl
                    value={REFERENCE_TOOL}
                    onDelete={noop}
                    onDuplicate={noop}
                    onChange={noop}
                />
            </Row>
        </div>
    ),
}

/** Read-only: no duplicate/remove controls, the editor is not writable. */
export const ReadOnly: Story = {
    args: {value: FUNCTION_TOOL, disabled: true},
    render: () => (
        <div className="max-w-[520px]">
            <ToolItemControl value={FUNCTION_TOOL} disabled onDelete={noop} onDuplicate={noop} />
        </div>
    ),
}
