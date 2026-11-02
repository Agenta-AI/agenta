import {useState} from "react"

import {ToolFormView} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ToolFormView — the Form side of the tool ConfigItemDrawer: a 240px ParameterTree rail
// beside a contextual detail panel (the selected parameter's editor, or the tool "basics"
// while nothing is selected).
//
// antd swaps in THIS file: `Input` → `@agenta/ui` `Input`; `Input.TextArea autoSize` →
// `AutosizeTextarea`; `Select options/onChange` → Radix `Select` composition;
// `Switch onChange` → `Switch onCheckedChange`; `Spin` → `Spinner`.
//
// NO `AntdVsAgenta` pair here, deliberately: the left rail (`agentTemplate/ParameterTree`,
// `ParameterNodeEditor`) is owned by a different migration chunk and is not exported, so an
// antd replay of this view could not hold the rail constant across the two halves and the
// diff would report that chunk's work as this one's. The migrated leaves are gated by
// their own parity stories — `DrillIn/ReferenceToolFormView` (AutosizeTextarea),
// `Drawers/RailField`, and the wave-1 `@agenta/ui` Input/Select/Switch grids. These
// stories are the inventory + state coverage for the composed view.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ToolFormView",
    component: ToolFormView,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Structured tool editor. Nothing selected → tool basics (name / description / permission / additionalProperties). A subagent routes to ReferenceToolFormView instead, which is a different surface entirely.",
            },
        },
    },
} satisfies Meta<typeof ToolFormView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const FUNCTION_TOOL = {
    type: "function",
    function: {
        name: "get_weather",
        description: "Get the current weather for a city",
        parameters: {
            type: "object",
            properties: {
                location: {type: "string", description: "City name"},
                units: {type: "string", description: "metric | imperial"},
            },
            required: ["location"],
            additionalProperties: false,
        },
    },
    permission: "ask",
}

const EMPTY_GATEWAY_TOOL = {
    type: "function",
    function: {
        name: "composio__github__GITHUB_CREATE_ISSUE__acme-github",
        description: "Open a new issue in a repository",
        parameters: {type: "object", properties: {}, required: [], additionalProperties: false},
    },
}

const REFERENCE_TOOL = {
    type: "reference",
    ref_by: "variant",
    slug: "summarizer",
    version: "3",
    description: "Summarize a support thread into three bullets",
    input_schema: {type: "object", properties: {thread: {type: "string"}}, required: ["thread"]},
}

function Frame({value, disabled}: {value: Record<string, unknown>; disabled?: boolean}) {
    const [current, setCurrent] = useState(value)
    return (
        <div className="flex h-[420px] w-[760px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
            <ToolFormView value={current} onChange={setCurrent} disabled={disabled} />
        </div>
    )
}

/** Tool basics: name, description, permission select, additionalProperties switch. */
export const FunctionTool: Story = {
    args: {value: FUNCTION_TOOL, onChange: noop},
    render: () => <Frame value={FUNCTION_TOOL} />,
}

/** A connected-app tool whose provider schema couldn't be loaded — the warning callout. */
export const GatewayToolWithoutSchema: Story = {
    args: {value: EMPTY_GATEWAY_TOOL, onChange: noop},
    render: () => <Frame value={EMPTY_GATEWAY_TOOL} />,
}

/** `type:"reference"` is a SUBAGENT: it routes to ReferenceToolFormView, not to this form. */
export const ReferenceTool: Story = {
    args: {value: REFERENCE_TOOL, onChange: noop},
    render: () => <Frame value={REFERENCE_TOOL} />,
}

/** Read-only (committed revision): every leaf takes the disabled skin. */
export const Disabled: Story = {
    args: {value: FUNCTION_TOOL, onChange: noop, disabled: true},
    render: () => <Frame value={FUNCTION_TOOL} disabled />,
}
