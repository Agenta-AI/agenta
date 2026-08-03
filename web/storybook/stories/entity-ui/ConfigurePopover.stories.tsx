import {useModelConfigurePopover} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {AntdConfigurePopoverContent, AntdModelConfigEditor} from "./playgroundConfigSectionAntd"
import {
    MODEL_OPTIONS,
    POPOVER_LLM_CONFIG_PROPS,
    POPOVER_LLM_CONFIG_VALUE,
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
// The hook owns the active tab, so the parity pair covers the RESTING panel (Model tab). The
// Fallback and Retry panes have their own parity stories.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ConfigurePopover",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Configure popover shell. antd Tabs → @agenta/ui Tabs (nav overrides become TabsList/TabsTrigger classes; visited panes keep antd's mounted behaviour via forceMount + an explicit hidden); antd Buttons → @agenta/ui Button; antd Typography.Text → span.",
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

function AntdConfigurePopover({
    disabled,
    withExtensions = true,
}: {
    disabled?: boolean
    withExtensions?: boolean
}) {
    return (
        <AntdConfigurePopoverContent
            activeTab="model"
            onTabChange={noop}
            hasPromptExtensionFields={withExtensions}
            disabled={disabled}
            modelPane={
                <AntdModelConfigEditor
                    value={POPOVER_LLM_CONFIG_VALUE}
                    onChange={noop}
                    llmConfigProps={POPOVER_LLM_CONFIG_PROPS as unknown as Record<string, unknown>}
                    modelOptions={MODEL_OPTIONS}
                    disabled={disabled}
                />
            }
            fallbackPane={null}
            retryPane={null}
            detailPane={null}
        />
    )
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
        className="grid grid-cols-[9rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject>{a}</div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject>{s}</div>
        </div>
    </div>
)

const TABS_NOTE =
    "antd animates the ink bar between tabs and the @agenta/ui Tabs reproduces that; at rest both render a 2px colorPrimary bar under the active tab. The Model pane's provider picker + sliders are shared by both halves."

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="model tab"
                expected={TABS_NOTE}
                a={<AntdConfigurePopover />}
                s={<AgentaConfigurePopover />}
            />
            <Row
                label="single tab"
                expected={TABS_NOTE}
                a={<AntdConfigurePopover withExtensions={false} />}
                s={<AgentaConfigurePopover withExtensions={false} />}
            />
            <Row
                label="disabled"
                expected={TABS_NOTE}
                a={<AntdConfigurePopover disabled />}
                s={<AgentaConfigurePopover disabled />}
            />
        </div>
    ),
}
