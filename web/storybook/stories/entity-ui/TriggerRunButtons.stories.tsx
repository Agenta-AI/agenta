import {RunInPlaygroundButton, RunSubscriptionButton} from "@agenta/entity-ui/gatewayTrigger"
import {Lightning, Play} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Tooltip as AntTooltip} from "antd"

// The trigger drawers' footer run-in-playground CTAs. The antd cells replay the
// pre-migration resting bodies verbatim from feat/storybook-data-seam:
// `<Tooltip><span><Button icon disabled/></span></Tooltip>` (disabled) and a default
// `<Button icon>` (enabled — the antd Popover/EventSourcePicker wrapper adds no resting
// chrome). The agenta cells render the migrated components (outline Button + icon child,
// Radix Tooltip / hover-Popover via PopoverAnchor).
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/RunButtons",
    component: RunInPlaygroundButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'antd `Button icon={...}` → `@agenta/ui` `Button variant="outline"` with the icon as a child; antd `Tooltip` → Radix Tooltip; the schedule button\'s antd hover-`Popover` preview → Radix Popover with a manual 100ms hover open (Radix has no hover trigger).',
            },
        },
    },
} satisfies Meta<typeof RunInPlaygroundButton>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject>{a}</div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject>{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {
        playgroundEntityId: "story-entity",
        name: "Digest",
        cron: "0 9 * * *",
        inputsText: "{}",
        message: "",
        onClose: noop,
    },
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="schedule · enabled (hover previews)"
                a={<AntButton icon={<Play size={14} />}>Run in playground</AntButton>}
                s={
                    <RunInPlaygroundButton
                        playgroundEntityId="story-entity"
                        name="Digest"
                        cron="0 9 * * *"
                        inputsText="{}"
                        message="Summarize yesterday's tickets."
                        onClose={noop}
                    />
                }
            />
            <Row
                label="schedule · disabled (draft)"
                a={
                    <AntTooltip title="Create the schedule first to run it">
                        <span>
                            <AntButton icon={<Play size={14} />} disabled>
                                Run in playground
                            </AntButton>
                        </span>
                    </AntTooltip>
                }
                s={
                    <RunInPlaygroundButton
                        playgroundEntityId="story-entity"
                        name="Digest"
                        cron="0 9 * * *"
                        inputsText="{}"
                        message=""
                        disabled
                        onClose={noop}
                    />
                }
            />
            <Row
                label="subscription · enabled (opens picker)"
                a={<AntButton icon={<Lightning size={14} />}>Run in playground</AntButton>}
                s={
                    <RunSubscriptionButton
                        playgroundEntityId="story-entity"
                        name="Digest"
                        eventKey="slack.message"
                        onClose={noop}
                    />
                }
            />
            <Row
                label="subscription · disabled (draft)"
                a={
                    <AntTooltip title="Create the trigger first to run it">
                        <span>
                            <AntButton icon={<Lightning size={14} />} disabled>
                                Run in playground
                            </AntButton>
                        </span>
                    </AntTooltip>
                }
                s={
                    <RunSubscriptionButton
                        playgroundEntityId="story-entity"
                        name="Digest"
                        eventKey="slack.message"
                        disabled
                        onClose={noop}
                    />
                }
            />
        </div>
    ),
}
