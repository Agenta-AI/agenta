import {RunInPlaygroundButton, RunSubscriptionButton} from "@agenta/entity-ui/gatewayTrigger"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The trigger drawers' footer run-in-playground CTAs: an outline Button with an icon child, with
// a Radix Tooltip when disabled and a hover-Popover (via PopoverAnchor) for schedules.
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/RunButtons",
    component: RunInPlaygroundButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Footer run-in-playground buttons for schedules and subscriptions. The schedule button previews its run in a Radix Popover that opens on a manual 100ms hover (Radix has no hover trigger).",
            },
        },
    },
} satisfies Meta<typeof RunInPlaygroundButton>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {
        playgroundEntityId: "story-entity",
        name: "Digest",
        cron: "0 9 * * *",
        inputsText: "{}",
        message: "",
        onClose: noop,
    },
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="schedule · enabled (hover previews)">
                <RunInPlaygroundButton
                    playgroundEntityId="story-entity"
                    name="Digest"
                    cron="0 9 * * *"
                    inputsText="{}"
                    message="Summarize yesterday's tickets."
                    onClose={noop}
                />
            </Row>
            <Row label="schedule · disabled (draft)">
                <RunInPlaygroundButton
                    playgroundEntityId="story-entity"
                    name="Digest"
                    cron="0 9 * * *"
                    inputsText="{}"
                    message=""
                    disabled
                    onClose={noop}
                />
            </Row>
            <Row label="subscription · enabled (opens picker)">
                <RunSubscriptionButton
                    playgroundEntityId="story-entity"
                    name="Digest"
                    eventKey="slack.message"
                    onClose={noop}
                />
            </Row>
            <Row label="subscription · disabled (draft)">
                <RunSubscriptionButton
                    playgroundEntityId="story-entity"
                    name="Digest"
                    eventKey="slack.message"
                    disabled
                    onClose={noop}
                />
            </Row>
        </div>
    ),
}
