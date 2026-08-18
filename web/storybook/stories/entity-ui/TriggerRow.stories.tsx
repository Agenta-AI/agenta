import {useState, type ReactNode} from "react"

import {TriggerRow} from "@agenta/entity-ui/drill-in"
import {DropdownMenuItem, DropdownMenuSeparator} from "@agenta/ui/ui"
import {MoreOutlined} from "@ant-design/icons"
import {Clock, ListChecks, PencilSimpleLine, Trash} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Dropdown as AntDropdown,
    Tooltip as AntTooltip,
    type MenuProps,
} from "antd"

// TriggerRow — the Triggers section's standalone schedule row. The antd cells replay the
// PRE-migration body verbatim from feat/storybook-data-seam (antd `Tooltip` on the status
// icon and a `Dropdown menu={{items}}` with an `icon={<MoreOutlined/>}` text button); the
// agenta cells render the migrated component. The run action now lives inside the ⋯ menu.
const meta = {
    title: "@agenta/entity-ui/DrillIn/TriggerRow",
    component: TriggerRow,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'antd `Tooltip` → Radix Tooltip; antd `Button type="text" icon` → `@agenta/ui` `Button variant="ghost" size="icon"` with the icon as a child; antd `Dropdown menu={{items:[…]}}` → `DropdownMenu` + composed `DropdownMenuItem` JSX (the `menuItems` array prop became a `menu` ReactNode, which also removes the antd `MenuProps` type leak).\n\nDeclared divergence: the "⋯" glyph moves from the antd icon-font `MoreOutlined` to Phosphor `DotsThreeVertical` — a different vector, so the actions button never pixel-matches.',
            },
        },
    },
} satisfies Meta<typeof TriggerRow>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

// ---------------------------------------------------------------------------
// The pre-migration antd row, replayed verbatim (only the props are inlined).
// ---------------------------------------------------------------------------

const ANTD_MENU: MenuProps["items"] = [
    {key: "deliveries", label: "View deliveries", icon: <ListChecks size={16} />},
    {key: "edit", label: "Edit", icon: <PencilSimpleLine size={16} />},
    {type: "divider"},
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
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
            <Trash size={16} />
            Delete
        </DropdownMenuItem>
    </>
)

function AntdTriggerRow({
    icon,
    name,
    nameMuted,
    chip,
    subtitle,
    active,
    disabled,
    menuOpen,
    menuContainer,
}: {
    icon: ReactNode
    name: string
    nameMuted?: boolean
    chip?: ReactNode
    subtitle: string
    active: boolean
    disabled?: boolean
    menuOpen?: boolean
    menuContainer?: HTMLElement | null
}) {
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            className={`group flex items-center gap-2.5 rounded border border-solid border-[var(--ag-colorBorderSecondary)] px-3 py-2 transition-colors ${disabled ? "cursor-default" : "cursor-pointer hover:border-[var(--ag-colorBorder)]"}`}
        >
            <AntTooltip title={active ? "Active" : "Paused"}>
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]">
                    {icon}
                    <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-solid border-[var(--ag-colorBgContainer)] ${
                            active
                                ? "bg-[var(--ag-colorSuccess)]"
                                : "bg-[var(--ag-colorTextQuaternary)]"
                        }`}
                    />
                </span>
            </AntTooltip>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span
                        className={`truncate text-xs font-medium ${
                            nameMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                        }`}
                    >
                        {name}
                    </span>
                    {chip ? (
                        <span className="ml-0.5 max-w-[170px] shrink-0 truncate rounded bg-[var(--ag-colorFillSecondary)] px-1.5 py-0.5 text-[10px] text-[var(--ag-colorTextSecondary)]">
                            {chip}
                        </span>
                    ) : null}
                </div>
                <div className="mt-0.5 line-clamp-2 max-w-prose text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                    {subtitle}
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-1" role="presentation">
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

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[11rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2"
        data-vrt-expected={expected}
    >
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

const ICON = <Clock size={15} />

export const AntdVsAgenta: Story = {
    args: {
        icon: ICON,
        name: "Morning digest",
        subtitle: "Summarize yesterday's tickets.",
        active: true,
        onOpen: noop,
        menu: AGENTA_MENU,
    },
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="active · named · cron chip"
                a={
                    <AntdTriggerRow
                        icon={ICON}
                        name="Morning digest"
                        chip="Every day at 09:00"
                        subtitle="Summarize yesterday's tickets."
                        active
                    />
                }
                s={
                    <TriggerRow
                        icon={ICON}
                        name="Morning digest"
                        chip="Every day at 09:00"
                        subtitle="Summarize yesterday's tickets."
                        active
                        onOpen={noop}
                        menu={AGENTA_MENU}
                    />
                }
            />
            <Row
                label="paused · unnamed (muted)"
                a={
                    <AntdTriggerRow
                        icon={ICON}
                        name="Untitled schedule"
                        nameMuted
                        subtitle="No message set"
                        active={false}
                    />
                }
                s={
                    <TriggerRow
                        icon={ICON}
                        name="Untitled schedule"
                        nameMuted
                        subtitle="No message set"
                        active={false}
                        onOpen={noop}
                        menu={AGENTA_MENU}
                    />
                }
            />
            <Row
                label="read-only"
                a={
                    <AntdTriggerRow
                        icon={ICON}
                        name="Weekly report"
                        chip="Every Monday at 08:00"
                        subtitle="Post the weekly summary to #ops."
                        active
                        disabled
                    />
                }
                s={
                    <TriggerRow
                        icon={ICON}
                        name="Weekly report"
                        chip="Every Monday at 08:00"
                        subtitle="Post the weekly summary to #ops."
                        active
                        disabled
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
        <div ref={setEl} className="relative min-h-[300px] w-[420px]">
            {el && render(el)}
        </div>
    )
}

/**
 * The row's "⋯" actions menu, forced open and rendered INLINE on both sides (antd
 * `open` + `getPopupContainer`, agenta `menuOpen` + `menuContainer`) so the VRT can
 * pixel-diff the overlay without driving any interaction. Both are real production
 * features (rendering inside modals / scroll containers).
 */
export const OpenState: Story = {
    args: {
        icon: ICON,
        name: "Morning digest",
        subtitle: "Summarize yesterday's tickets.",
        active: true,
        onOpen: noop,
        menu: AGENTA_MENU,
    },
    render: () => (
        <div className="flex gap-16 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntdTriggerRow
                            icon={ICON}
                            name="Morning digest"
                            chip="Every day at 09:00"
                            subtitle="Summarize yesterday's tickets."
                            active
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
                        <TriggerRow
                            icon={ICON}
                            name="Morning digest"
                            chip="Every day at 09:00"
                            subtitle="Summarize yesterday's tickets."
                            active
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
