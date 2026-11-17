import {RetryConfigTab} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

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
                    "Retry pane: max-retries and base-delay sliders plus a retry-policy select. The select is enabled only when max retries is above zero.",
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {...BASE, maxRetries: 3, baseDelay: 500, retryPolicy: "capacity"},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="retries off">
                <RetryConfigTab {...BASE} maxRetries={0} baseDelay={null} />
            </Row>
            <Row label="retries on · policy">
                <RetryConfigTab {...BASE} maxRetries={3} baseDelay={500} retryPolicy="capacity" />
            </Row>
            <Row label="disabled">
                <RetryConfigTab
                    {...BASE}
                    maxRetries={3}
                    baseDelay={500}
                    retryPolicy="capacity"
                    disabled
                />
            </Row>
        </div>
    ),
}
