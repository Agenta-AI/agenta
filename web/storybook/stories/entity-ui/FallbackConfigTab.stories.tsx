import {FallbackConfigTab} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    FALLBACK_CONFIGS,
    FALLBACK_CONFIG_KEYS,
    FALLBACK_CONFIGS_SCHEMA,
    FALLBACK_POLICY_OPTIONS,
    FALLBACK_POLICY_SCHEMA,
    noop,
} from "./playgroundConfigSectionFixtures"

// FallbackConfigTab — the "Fallback" pane: a policy select whose options carry a right-aligned
// description, plus the fallback model rail (edit / remove / add) that is
// gated on a policy being picked, with the gate reason on a tooltip.
const meta = {
    title: "@agenta/entity-ui/DrillIn/FallbackConfigTab",
    component: FallbackConfigTab,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Fallback pane: a policy select with option descriptions, and the fallback model rail (edit / remove / add) gated on a policy being picked.",
            },
        },
    },
} satisfies Meta<typeof FallbackConfigTab>

export default meta
type Story = StoryObj<typeof meta>

const BASE = {
    fallbackConfigs: FALLBACK_CONFIGS,
    fallbackConfigKeys: FALLBACK_CONFIG_KEYS,
    fallbackPolicyOptions: FALLBACK_POLICY_OPTIONS,
    fallbackPolicySchema: FALLBACK_POLICY_SCHEMA,
    fallbackConfigsSchema: FALLBACK_CONFIGS_SCHEMA,
    onPolicyChange: noop,
    onAddFallbackModel: noop,
    onEditFallbackModel: noop,
    onRemoveFallbackModel: noop,
}

export const NoPolicy: Story = {
    args: {...BASE, fallbackPolicy: null, fallbackConfigs: [], fallbackConfigKeys: []},
    render: (args) => (
        <div className="w-[296px]">
            <FallbackConfigTab {...args} />
        </div>
    ),
}

export const WithModels: Story = {
    args: {...BASE, fallbackPolicy: "availability"},
    render: (args) => (
        <div className="w-[296px]">
            <FallbackConfigTab {...args} />
        </div>
    ),
}

export const Disabled: Story = {
    args: {...BASE, fallbackPolicy: "availability", disabled: true},
    render: (args) => (
        <div className="w-[296px]">
            <FallbackConfigTab {...args} />
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
    args: {...BASE, fallbackPolicy: "availability"},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="no policy">
                <FallbackConfigTab
                    {...BASE}
                    fallbackPolicy={null}
                    fallbackConfigs={[]}
                    fallbackConfigKeys={[]}
                />
            </Row>
            <Row label="policy · 2 models">
                <FallbackConfigTab {...BASE} fallbackPolicy="availability" />
            </Row>
            <Row label="disabled">
                <FallbackConfigTab {...BASE} fallbackPolicy="availability" disabled />
            </Row>
        </div>
    ),
}
