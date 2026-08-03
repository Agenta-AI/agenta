import {FallbackConfigTab} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {AntdFallbackConfigTab} from "./playgroundConfigSectionAntd"
import {
    FALLBACK_CONFIGS,
    FALLBACK_CONFIG_KEYS,
    FALLBACK_CONFIGS_SCHEMA,
    FALLBACK_POLICY_OPTIONS,
    FALLBACK_POLICY_SCHEMA,
    noop,
} from "./playgroundConfigSectionFixtures"

// FallbackConfigTab — the "Fallback" pane: a policy select whose options carry a right-aligned
// description (antd `optionRender`), plus the fallback model rail (edit / remove / add) that is
// gated on a policy being picked, with the gate reason on a tooltip.
const meta = {
    title: "@agenta/entity-ui/DrillIn/FallbackConfigTab",
    component: FallbackConfigTab,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Fallback pane. antd Select(allowClear + optionRender) → composed ConfigSelect; antd Tooltip(title?) → HintTooltip (no hint, no tooltip); antd Buttons → @agenta/ui Button (icon-only remove = size=icon-sm, block = w-full).",
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

const SELECT_NOTE =
    "policy Select: antd small (7px pad) vs @agenta/ui Select trigger at size=sm; option descriptions live in the dropdown on both (forced-open panels are not compared here)"

export const AntdVsAgenta: Story = {
    args: {...BASE, fallbackPolicy: "availability"},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="no policy"
                expected={SELECT_NOTE}
                a={
                    <AntdFallbackConfigTab
                        {...BASE}
                        fallbackPolicy={null}
                        fallbackConfigs={[]}
                        fallbackConfigKeys={[]}
                    />
                }
                s={
                    <FallbackConfigTab
                        {...BASE}
                        fallbackPolicy={null}
                        fallbackConfigs={[]}
                        fallbackConfigKeys={[]}
                    />
                }
            />
            <Row
                label="policy · 2 models"
                expected={SELECT_NOTE}
                a={<AntdFallbackConfigTab {...BASE} fallbackPolicy="availability" />}
                s={<FallbackConfigTab {...BASE} fallbackPolicy="availability" />}
            />
            <Row
                label="disabled"
                expected={SELECT_NOTE}
                a={<AntdFallbackConfigTab {...BASE} fallbackPolicy="availability" disabled />}
                s={<FallbackConfigTab {...BASE} fallbackPolicy="availability" disabled />}
            />
        </div>
    ),
}
