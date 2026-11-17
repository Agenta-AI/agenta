import {useState} from "react"

import {EventSourcePicker, type SampledEvent} from "@agenta/entity-ui/gatewayTrigger"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// EventSourcePicker — the "wait for a new event / pick a recent one" popover used by the
// subscription drawer (mapping sample + run-in-playground). The stories force it open inline
// (`defaultOpen` + `container`, both real production features).
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/EventSourcePicker",
    component: EventSourcePicker,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Shared event-sourcing popover: a wait-for-new-event row plus recent events (or an empty state). `placement` maps to Radix side/align.",
            },
        },
    },
} satisfies Meta<typeof EventSourcePicker>

export default meta
type Story = StoryObj<typeof meta>

const EVENTS: SampledEvent[] = [
    {
        id: "e1",
        label: "DM from @alex",
        preview: "hey — can you rerun the digest?",
        timeAgo: "2m ago",
        payload: {},
    },
    {id: "e2", label: "Channel message in #ops", timeAgo: "18m ago", payload: {}},
]

const waitForever = () => new Promise<SampledEvent | null>(() => undefined)

function Panel({render}: {render: (c: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[260px] w-[340px]">
            {el && render(el)}
        </div>
    )
}

const noop = () => undefined

export const OpenState: Story = {
    args: {trigger: null, recentEvents: EVENTS, onPick: noop},
    render: () => (
        <div className="p-4">
            <Panel
                render={(c) => (
                    <EventSourcePicker
                        defaultOpen
                        container={c}
                        placement="bottomLeft"
                        trigger={<Button variant="outline">Test event</Button>}
                        recentEvents={EVENTS}
                        onPick={noop}
                        onWaitForEvent={waitForever}
                        waitHint="trigger it from the app now"
                    />
                )}
            />
        </div>
    ),
}

export const OpenStateEmpty: Story = {
    args: {trigger: null, recentEvents: [], onPick: noop},
    render: () => (
        <div className="p-4">
            <Panel
                render={(c) => (
                    <EventSourcePicker
                        defaultOpen
                        container={c}
                        placement="bottomLeft"
                        trigger={<Button variant="outline">Test event</Button>}
                        recentEvents={[]}
                        onPick={noop}
                        onWaitForEvent={waitForever}
                    />
                )}
            />
        </div>
    ),
}
