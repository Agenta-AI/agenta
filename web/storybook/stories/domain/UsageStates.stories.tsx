import type {Meta, StoryObj} from "@storybook/nextjs"

// Not exported from @agenta/observability-ui/usage — import direct.
import {UsageCard} from "../../../packages/agenta-observability-ui/src/usage/cards/UsageCard"
import {USAGE_COLOR_CSS} from "../../../packages/agenta-observability-ui/src/usage/colors"
import {UsageEmptyState} from "../../../packages/agenta-observability-ui/src/usage/UsageEmptyState"

/**
 * The Usage tab's states a reviewer cannot reach by clicking on a project with data: a project
 * with no agents yet, and a card that is loading, failed, or matches no runs.
 */
const meta = {
    title: "@agenta/observability-ui/Usage/States",
    parameters: {layout: "padded"},
    decorators: [
        (Story) => (
            <div className="max-w-[880px]">
                <style>{USAGE_COLOR_CSS}</style>
                <Story />
            </div>
        ),
    ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const NoAgentsYet: Story = {
    render: () => <UsageEmptyState onCreateAgent={() => undefined} />,
}

export const CardLoading: Story = {
    render: () => <UsageCard title="Cost" onExplore={() => undefined} loading chartHeight={210} />,
}

export const CardError: Story = {
    render: () => (
        <UsageCard
            title="Cost"
            onExplore={() => undefined}
            error={new Error("Request failed")}
            onRetry={() => undefined}
            chartHeight={210}
        />
    ),
}

export const CardNoMatch: Story = {
    render: () => (
        <UsageCard
            title="Cost"
            value="$0.000"
            caption="Last 30 days"
            onExplore={() => undefined}
            empty={{text: "No runs match your filters", onClear: () => undefined}}
            chartHeight={210}
        />
    ),
}

export const CardNothingInRange: Story = {
    render: () => (
        <UsageCard
            title="Tokens by type"
            value="0"
            caption="Last 24 hours"
            empty={{text: "No tokens in the last 24 hours"}}
            chartHeight={150}
        />
    ),
}
