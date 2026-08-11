import {RetryConfigTab} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {AntdRetryConfigTab} from "./playgroundConfigSectionAntd"
import {
    RETRY_CONFIG_SCHEMA,
    RETRY_POLICY_OPTIONS,
    RETRY_POLICY_SCHEMA,
    noop,
} from "./playgroundConfigSectionFixtures"

// RetryConfigTab — the "Retry" pane: max-retries / base-delay sliders (shared
// NumberSliderControl, not part of this chunk) plus the policy select, which is gated on
// max_retries > 0 and carries the gate reason on a tooltip.
const meta = {
    title: "@agenta/entity-ui/DrillIn/RetryConfigTab",
    component: RetryConfigTab,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Retry pane. antd Select(allowClear + optionRender) → composed ConfigSelect; antd Tooltip(title?) → HintTooltip; antd Typography.Text → span + colorTextDescription.",
            },
        },
    },
} satisfies Meta<typeof RetryConfigTab>

export default meta
type Story = StoryObj<typeof meta>

const BASE = {
    retryPolicyOptions: RETRY_POLICY_OPTIONS,
    retryPolicySchema: RETRY_POLICY_SCHEMA,
    retryConfigSchema: RETRY_CONFIG_SCHEMA,
    onPolicyChange: noop,
    onConfigFieldChange: noop,
}

export const RetriesOff: Story = {
    args: {...BASE, maxRetries: 0, baseDelay: null, retryPolicy: null},
    render: (args) => (
        <div className="w-[296px]">
            <RetryConfigTab {...args} />
        </div>
    ),
}

export const RetriesOn: Story = {
    args: {...BASE, maxRetries: 3, baseDelay: 500, retryPolicy: "capacity"},
    render: (args) => (
        <div className="w-[296px]">
            <RetryConfigTab {...args} />
        </div>
    ),
}

export const Disabled: Story = {
    args: {...BASE, maxRetries: 3, baseDelay: 500, retryPolicy: "capacity", disabled: true},
    render: (args) => (
        <div className="w-[296px]">
            <RetryConfigTab {...args} />
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
    "policy Select: antd small (7px pad) vs @agenta/ui Select trigger at size=sm; option descriptions live in the dropdown on both"

export const AntdVsAgenta: Story = {
    args: {...BASE, maxRetries: 3, baseDelay: 500, retryPolicy: "capacity"},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="retries off"
                expected={SELECT_NOTE}
                a={<AntdRetryConfigTab {...BASE} maxRetries={0} baseDelay={null} />}
                s={<RetryConfigTab {...BASE} maxRetries={0} baseDelay={null} />}
            />
            <Row
                label="retries on · policy"
                expected={SELECT_NOTE}
                a={
                    <AntdRetryConfigTab
                        {...BASE}
                        maxRetries={3}
                        baseDelay={500}
                        retryPolicy="capacity"
                    />
                }
                s={
                    <RetryConfigTab
                        {...BASE}
                        maxRetries={3}
                        baseDelay={500}
                        retryPolicy="capacity"
                    />
                }
            />
            <Row
                label="disabled"
                expected={SELECT_NOTE}
                a={
                    <AntdRetryConfigTab
                        {...BASE}
                        maxRetries={3}
                        baseDelay={500}
                        retryPolicy="capacity"
                        disabled
                    />
                }
                s={
                    <RetryConfigTab
                        {...BASE}
                        maxRetries={3}
                        baseDelay={500}
                        retryPolicy="capacity"
                        disabled
                    />
                }
            />
        </div>
    ),
}
