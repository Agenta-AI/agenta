import {useModelConfigurePopover} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    MODEL_OPTIONS,
    POPOVER_PARAMETERS,
    POPOVER_PARAMETERS_NO_EXTENSIONS,
    POPOVER_SCHEMA,
    POPOVER_SCHEMA_NO_EXTENSIONS,
    noop,
} from "./playgroundConfigSectionFixtures"

// ConfigurePopover — the panel `useModelConfigurePopover` builds and `useFieldSlots` hangs off
// the section header's model button: a header strip (back / title / "new" chip / reset) over
// the Model | Fallback | Retry tabs, or the fallback-detail editor.
//
// The hook owns the active tab, so `Variants` covers the RESTING panel (Model tab). The
// Fallback and Retry panes have their own stories.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ConfigurePopover",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Configure popover shell: a header strip (back / title / new chip / reset) over the Model, Fallback and Retry tabs.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function AgentaConfigurePopover({
    disabled,
    withExtensions = true,
}: {
    disabled?: boolean
    withExtensions?: boolean
}) {
    const parameters = withExtensions ? POPOVER_PARAMETERS : POPOVER_PARAMETERS_NO_EXTENSIONS
    const schema = withExtensions ? POPOVER_SCHEMA : POPOVER_SCHEMA_NO_EXTENSIONS
    const {configurePopoverContent} = useModelConfigurePopover({
        activeData: {parameters},
        disabled: !!disabled,
        dispatchUpdate: noop,
        llmProviderConfig: {extraOptionGroups: MODEL_OPTIONS} as never,
        parameters,
        revisionId: "rev-story",
        schema: schema as never,
        serverData: {parameters},
    })
    return <>{configurePopoverContent}</>
}

export const Default: Story = {
    render: () => <AgentaConfigurePopover />,
}

export const SingleTab: Story = {
    render: () => <AgentaConfigurePopover withExtensions={false} />,
}

export const Disabled: Story = {
    render: () => <AgentaConfigurePopover disabled />,
}

// ---------------------------------------------------------------------------

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row label="model tab">
                <AgentaConfigurePopover />
            </Row>
            <Row label="single tab">
                <AgentaConfigurePopover withExtensions={false} />
            </Row>
            <Row label="disabled">
                <AgentaConfigurePopover disabled />
            </Row>
        </div>
    ),
}
