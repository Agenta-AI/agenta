import {AdvancedConfigFields} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {ADVANCED_ENTRIES, noop} from "./playgroundConfigSectionFixtures"

// AdvancedConfigFields — the "Advanced" disclosure inside the model pane: a caret toggle over
// a JSON editor per advanced key (today only `chat_template_kwargs`). The editor is the shared
// `SharedEditor`.
const meta = {
    title: "@agenta/entity-ui/DrillIn/AdvancedConfigFields",
    component: AdvancedConfigFields,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Advanced (chat_template_kwargs) disclosure: a caret toggle over a JSON editor per advanced key.",
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[296px]">{children}</div>
    </div>
)

export const Variants: Story = {
    args: BASE,
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="collapsed">
                <AdvancedConfigFields {...BASE} />
            </Row>
            <Row label="expanded">
                <AdvancedConfigFields {...BASE} defaultOpen />
            </Row>
            <Row label="expanded · with value">
                <AdvancedConfigFields
                    {...BASE}
                    value={{chat_template_kwargs: {thinking: true}}}
                    defaultOpen
                />
            </Row>
            <Row label="disabled">
                <AdvancedConfigFields {...BASE} defaultOpen disabled />
            </Row>
        </div>
    ),
}
