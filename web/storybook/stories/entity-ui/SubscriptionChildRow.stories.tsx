import {useState, type ReactNode} from "react"

import {SubscriptionChildRow} from "@agenta/entity-ui/drill-in"
import {DropdownMenuItem, DropdownMenuSeparator} from "@agenta/ui/ui"
import {ArrowsClockwise, ListChecks, PencilSimpleLine, Trash, XCircle} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SubscriptionChildRow — one subscription under its provider group in the Triggers section.
// It mirrors the schedule TriggerRow: a provider-logo icon box with a status dot, the
// primary/secondary text, and a "⋯" actions menu. "Run in playground" now lives INSIDE that
// menu (it opens the EventSourcePicker), so the row no longer renders a standalone flask.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SubscriptionChildRow",
    component: SubscriptionChildRow,
    parameters: {layout: "padded"},
} satisfies Meta<typeof SubscriptionChildRow>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

// The container-supplied part of the menu (the run action is prepended by the row itself).
const AGENTA_MENU = (
    <>
        <DropdownMenuItem>
            <ListChecks size={16} />
            View deliveries
        </DropdownMenuItem>
        <DropdownMenuItem>
            <PencilSimpleLine size={16} />
            Edit
        </DropdownMenuItem>
        <DropdownMenuItem>
            <ArrowsClockwise size={16} />
            Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
            <XCircle size={16} />
            Revoke
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive">
            <Trash size={16} />
            Delete
        </DropdownMenuItem>
    </>
)

const baseRunProps = {
    subscriptionId: "story-subscription",
    runLabel: "Message reaction added",
    eventKey: "SLACK_MESSAGE_REACTION_ADDED",
    playgroundEntityId: "story-entity",
}

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="min-w-0" data-vrt-subject>
            {children}
        </div>
    </div>
)

export const Variants: Story = {
    args: {
        primary: "Message reaction added",
        active: true,
        onOpen: noop,
        menu: AGENTA_MENU,
        ...baseRunProps,
    },
    render: () => (
        <div className="flex max-w-[520px] flex-col">
            <Row label="active · named + event">
                <SubscriptionChildRow
                    primary="Ops escalations"
                    secondary="Message reaction added"
                    active
                    onOpen={noop}
                    menu={AGENTA_MENU}
                    {...baseRunProps}
                />
            </Row>
            <Row label="paused · unnamed (muted)">
                <SubscriptionChildRow
                    primary="Untitled subscription"
                    primaryMuted
                    secondary="Slack workspace"
                    active={false}
                    onOpen={noop}
                    menu={AGENTA_MENU}
                    {...baseRunProps}
                />
            </Row>
            <Row label="read-only · run disabled">
                <SubscriptionChildRow
                    primary="Ops escalations"
                    active
                    disabled
                    runDisabled
                    onOpen={noop}
                    menu={AGENTA_MENU}
                    {...baseRunProps}
                />
            </Row>
        </div>
    ),
}

function Panel({render}: {render: (c: HTMLElement) => ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[320px] w-[400px]">
            {el && render(el)}
        </div>
    )
}

/** The "⋯" actions menu forced open (run action + the container items) for VRT. */
export const OpenState: Story = {
    args: {
        primary: "Ops escalations",
        active: true,
        onOpen: noop,
        menu: AGENTA_MENU,
        ...baseRunProps,
    },
    render: () => (
        <Panel
            render={(c) => (
                <SubscriptionChildRow
                    primary="Ops escalations"
                    secondary="Message reaction added"
                    active
                    onOpen={noop}
                    menu={AGENTA_MENU}
                    menuOpen
                    menuContainer={c}
                    {...baseRunProps}
                />
            )}
        />
    ),
}
