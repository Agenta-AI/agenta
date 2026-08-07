import {useState} from "react"

import {EventSourcePicker, type SampledEvent} from "@agenta/entity-ui/gatewayTrigger"
import {ClockCountdown, Lightning} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Empty as AntEmpty, Popover as AntPopover} from "antd"

// EventSourcePicker — the "wait for a new event / pick a recent one" popover used by the
// subscription drawer (mapping sample + run-in-playground). The antd half replays the
// pre-migration body verbatim from feat/storybook-data-seam: an antd `Popover`
// (trigger="click") whose content is the same hand-rolled rows, with antd `Empty`/`Spin`
// for the empty/waiting states. The agenta half is the migrated component itself,
// forced open inline (`defaultOpen` + `container`, both real production features).
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/EventSourcePicker",
    component: EventSourcePicker,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Shared event-sourcing popover. antd `Popover`/`Empty`/`Spin` → `@agenta/ui` `Popover`/`EmptyState`/`Spinner`; the row markup is unchanged. `placement` maps to Radix side/align; the content carries antd's 12px popover padding (`p-3`).",
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

/** Pre-migration popover CONTENT, verbatim (wait row + recent events / empty). */
const AntdContent = ({events, waitHint}: {events: SampledEvent[]; waitHint?: string}) => (
    <div className="w-[280px]">
        <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded border-0 bg-transparent px-2.5 py-2 text-left hover:bg-[var(--ag-colorFillTertiary)] disabled:cursor-default"
        >
            <ClockCountdown size={16} className="text-[var(--ag-colorTextSecondary)]" />
            <span className="min-w-0 flex-1">
                <span className="block text-xs text-[var(--ag-colorText)]">
                    Wait for a new event
                </span>
                {waitHint && (
                    <span className="block text-[11px] text-[var(--ag-colorTextTertiary)]">
                        {waitHint}
                    </span>
                )}
            </span>
        </button>
        <div className="mb-1 mt-1.5 px-2.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
            Recent events
        </div>
        {events.length === 0 ? (
            <AntEmpty
                image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
                description={
                    <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                        None captured yet
                    </span>
                }
                className="!my-2"
            />
        ) : (
            <div className="flex flex-col">
                {events.map((event) => (
                    <button
                        key={event.id}
                        type="button"
                        className="flex cursor-pointer items-center gap-2.5 rounded border-0 bg-transparent px-2.5 py-1.5 text-left hover:bg-[var(--ag-colorFillTertiary)]"
                    >
                        <Lightning size={15} className="text-[var(--ag-colorTextSecondary)]" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-[var(--ag-colorText)]">
                                {event.label}
                                {event.preview ? ` · ${event.preview}` : ""}
                            </span>
                            {event.timeAgo && (
                                <span className="block text-[11px] text-[var(--ag-colorTextTertiary)]">
                                    {event.timeAgo}
                                </span>
                            )}
                        </span>
                    </button>
                ))}
            </div>
        )}
    </div>
)

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
        <div className="flex gap-24 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntPopover
                            open
                            getPopupContainer={() => c}
                            trigger="click"
                            placement="bottomLeft"
                            content={
                                <AntdContent
                                    events={EVENTS}
                                    waitHint="trigger it from the app now"
                                />
                            }
                        >
                            <AntButton>Test event</AntButton>
                        </AntPopover>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <EventSourcePicker
                            defaultOpen
                            container={c}
                            placement="bottomLeft"
                            trigger={<AntButton>Test event</AntButton>}
                            recentEvents={EVENTS}
                            onPick={noop}
                            onWaitForEvent={waitForever}
                            waitHint="trigger it from the app now"
                        />
                    )}
                />
            </div>
        </div>
    ),
}

export const OpenStateEmpty: Story = {
    args: {trigger: null, recentEvents: [], onPick: noop},
    render: () => (
        <div className="flex gap-24 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntPopover
                            open
                            getPopupContainer={() => c}
                            trigger="click"
                            placement="bottomLeft"
                            content={<AntdContent events={[]} />}
                        >
                            <AntButton>Test event</AntButton>
                        </AntPopover>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <EventSourcePicker
                            defaultOpen
                            container={c}
                            placement="bottomLeft"
                            trigger={<AntButton>Test event</AntButton>}
                            recentEvents={[]}
                            onPick={noop}
                            onWaitForEvent={waitForever}
                        />
                    )}
                />
            </div>
        </div>
    ),
}
