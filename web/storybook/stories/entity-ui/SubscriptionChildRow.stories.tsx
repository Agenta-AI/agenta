import {useState, type ReactNode} from "react"

import {SubscriptionChildRow, SubscriptionRunPopover} from "@agenta/entity-ui/drill-in"
import {DropdownMenuItem, DropdownMenuSeparator} from "@agenta/ui/ui"
import {MoreOutlined} from "@ant-design/icons"
import {
    ArrowsClockwise,
    Flask,
    ListChecks,
    PencilSimpleLine,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Dropdown as AntDropdown,
    Tooltip as AntTooltip,
    type MenuProps,
} from "antd"

// SubscriptionChildRow — one subscription under its provider group in the Triggers
// section, plus the SubscriptionRunPopover flask it hosts in `runSlot`. The antd cells
// replay the PRE-migration bodies verbatim from feat/storybook-data-seam (antd `Tooltip`
// on the status dot, `Dropdown menu={{items}}` + `Button type="text" icon={<MoreOutlined/>}`,
// and — for the run slot — `<Tooltip><Button type="text" icon={<Flask/>}/></Tooltip>`).
const meta = {
    title: "@agenta/entity-ui/DrillIn/SubscriptionChildRow",
    component: SubscriptionChildRow,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'antd `Tooltip` → Radix Tooltip; antd `Dropdown menu={{items:[…]}}` → `DropdownMenu` + composed `DropdownMenuItem` JSX (the antd-typed `menuItems: MenuProps["items"]` prop became a `menu: ReactNode`); antd text icon `Button` → `@agenta/ui` `Button variant="ghost" size="icon"`.\n\nThe run-slot flask (`SubscriptionRunPopover`) composes a Radix Tooltip with the EventSourcePicker\'s popover trigger by NESTING both `asChild` triggers on the same button — wrapping the popover trigger in a Tooltip would make PopoverTrigger\'s Slot clone the Tooltip instead of the button.',
            },
        },
    },
} satisfies Meta<typeof SubscriptionChildRow>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const ANTD_MENU: MenuProps["items"] = [
    {key: "deliveries", label: "View deliveries", icon: <ListChecks size={16} />},
    {key: "edit", label: "Edit", icon: <PencilSimpleLine size={16} />},
    {key: "refresh", label: "Refresh", icon: <ArrowsClockwise size={16} />},
    {type: "divider"},
    {key: "revoke", label: "Revoke", icon: <XCircle size={16} />},
    {key: "delete", label: "Delete", icon: <Trash size={16} />, danger: true},
]

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

/** The pre-migration run-slot flask: an antd Tooltip over a text icon Button. */
const AntdRunSlot = ({disabled}: {disabled?: boolean}) => (
    <AntTooltip title="Run in playground">
        <AntButton
            type="text"
            icon={<Flask size={16} />}
            aria-label="Run in playground"
            disabled={disabled}
        />
    </AntTooltip>
)

function AntdSubscriptionChildRow({
    primary,
    primaryMuted,
    secondary,
    active,
    disabled,
    runSlot,
    menuOpen,
    menuContainer,
}: {
    primary: string
    primaryMuted?: boolean
    secondary?: string
    active: boolean
    disabled?: boolean
    runSlot: ReactNode
    menuOpen?: boolean
    menuContainer?: HTMLElement | null
}) {
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            className={`group flex items-center gap-2.5 rounded px-2.5 py-1.5 transition-colors ${
                disabled
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-[var(--ag-colorFillSecondary)]"
            }`}
        >
            <AntTooltip title={active ? "Active" : "Paused"}>
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                        active
                            ? "bg-[var(--ag-colorSuccess)]"
                            : "bg-[var(--ag-colorTextQuaternary)]"
                    }`}
                />
            </AntTooltip>
            <div className="min-w-0 flex-1">
                <div
                    className={`truncate text-xs font-medium ${
                        primaryMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                    }`}
                >
                    {primary}
                </div>
                {secondary ? (
                    <div className="truncate text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                        {secondary}
                    </div>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1" role="presentation">
                {runSlot}
                <AntDropdown
                    trigger={["click"]}
                    styles={{root: {width: 180}}}
                    menu={{items: ANTD_MENU}}
                    open={menuOpen}
                    getPopupContainer={menuContainer ? () => menuContainer : undefined}
                >
                    <AntButton
                        type="text"
                        icon={<MoreOutlined />}
                        aria-label="Open trigger actions"
                    />
                </AntDropdown>
            </div>
        </div>
    )
}

const Row = ({label, a, s}: {label: string; a: ReactNode; s: ReactNode}) => (
    <div className="grid grid-cols-[11rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div className="min-w-0 flex-1" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className="min-w-0 flex-1" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

const runSlot = (disabled?: boolean) => (
    <SubscriptionRunPopover
        subscriptionId="story-subscription"
        label="Message reaction added"
        eventKey="SLACK_MESSAGE_REACTION_ADDED"
        playgroundEntityId="story-entity"
        disabled={disabled}
    />
)

export const AntdVsAgenta: Story = {
    args: {
        primary: "Message reaction added",
        active: true,
        runSlot: null,
        onOpen: noop,
        menu: AGENTA_MENU,
    },
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="active · named + event"
                a={
                    <AntdSubscriptionChildRow
                        primary="Ops escalations"
                        secondary="Message reaction added"
                        active
                        runSlot={<AntdRunSlot />}
                    />
                }
                s={
                    <SubscriptionChildRow
                        primary="Ops escalations"
                        secondary="Message reaction added"
                        active
                        runSlot={runSlot()}
                        onOpen={noop}
                        menu={AGENTA_MENU}
                    />
                }
            />
            <Row
                label="paused · unnamed (muted)"
                a={
                    <AntdSubscriptionChildRow
                        primary="Untitled subscription"
                        primaryMuted
                        secondary="Slack workspace"
                        active={false}
                        runSlot={<AntdRunSlot />}
                    />
                }
                s={
                    <SubscriptionChildRow
                        primary="Untitled subscription"
                        primaryMuted
                        secondary="Slack workspace"
                        active={false}
                        runSlot={runSlot()}
                        onOpen={noop}
                        menu={AGENTA_MENU}
                    />
                }
            />
            <Row
                label="read-only · run disabled"
                a={
                    <AntdSubscriptionChildRow
                        primary="Ops escalations"
                        active
                        disabled
                        runSlot={<AntdRunSlot disabled />}
                    />
                }
                s={
                    <SubscriptionChildRow
                        primary="Ops escalations"
                        active
                        disabled
                        runSlot={runSlot(true)}
                        onOpen={noop}
                        menu={AGENTA_MENU}
                    />
                }
            />
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

/**
 * The row's "⋯" actions menu (6 items + a separator, the subscription set), forced open
 * and rendered INLINE on both sides — antd `open` + `getPopupContainer`, agenta
 * `menuOpen` + `menuContainer` — so the VRT pixel-diffs the overlay with no interaction.
 */
export const OpenState: Story = {
    args: {
        primary: "Ops escalations",
        active: true,
        runSlot: null,
        onOpen: noop,
        menu: AGENTA_MENU,
    },
    render: () => (
        <div className="flex gap-16 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntdSubscriptionChildRow
                            primary="Ops escalations"
                            secondary="Message reaction added"
                            active
                            runSlot={<AntdRunSlot />}
                            menuOpen
                            menuContainer={c}
                        />
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <SubscriptionChildRow
                            primary="Ops escalations"
                            secondary="Message reaction added"
                            active
                            runSlot={runSlot()}
                            onOpen={noop}
                            menu={AGENTA_MENU}
                            menuOpen
                            menuContainer={c}
                        />
                    )}
                />
            </div>
        </div>
    ),
}
