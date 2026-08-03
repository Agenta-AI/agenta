import {AdvancedConfigFields} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {AntdAdvancedConfigFields} from "./playgroundConfigSectionAntd"
import {ADVANCED_ENTRIES, noop} from "./playgroundConfigSectionFixtures"

// AdvancedConfigFields — the "Advanced" disclosure inside the model pane: a caret toggle over
// a JSON editor per advanced key (today only `chat_template_kwargs`). Only antd
// `Typography.Text` was in play here; the toggle was already a native button and the editor is
// the shared `SharedEditor`.
const meta = {
    title: "@agenta/entity-ui/DrillIn/AdvancedConfigFields",
    component: AdvancedConfigFields,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Advanced (chat_template_kwargs) disclosure. antd Typography.Text → span; `type="secondary"` → text-colorTextDescription (antd\'s Typography secondary token).',
            },
        },
    },
} satisfies Meta<typeof AdvancedConfigFields>

export default meta
type Story = StoryObj<typeof meta>

const BASE = {entries: ADVANCED_ENTRIES, value: {}, onChange: noop}

export const Collapsed: Story = {
    args: BASE,
    render: (args) => (
        <div className="w-[296px]">
            <AdvancedConfigFields {...args} />
        </div>
    ),
}

export const Expanded: Story = {
    args: {...BASE, defaultOpen: true},
    render: (args) => (
        <div className="w-[296px]">
            <AdvancedConfigFields {...args} />
        </div>
    ),
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
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[296px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[296px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: BASE,
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="collapsed"
                a={<AntdAdvancedConfigFields {...BASE} />}
                s={<AdvancedConfigFields {...BASE} />}
            />
            <Row
                label="expanded"
                a={<AntdAdvancedConfigFields {...BASE} defaultOpen />}
                s={<AdvancedConfigFields {...BASE} defaultOpen />}
            />
            <Row
                label="expanded · with value"
                a={
                    <AntdAdvancedConfigFields
                        {...BASE}
                        value={{chat_template_kwargs: {thinking: true}}}
                        defaultOpen
                    />
                }
                s={
                    <AdvancedConfigFields
                        {...BASE}
                        value={{chat_template_kwargs: {thinking: true}}}
                        defaultOpen
                    />
                }
            />
            <Row
                label="disabled"
                a={<AntdAdvancedConfigFields {...BASE} defaultOpen disabled />}
                s={<AdvancedConfigFields {...BASE} defaultOpen disabled />}
            />
        </div>
    ),
}
