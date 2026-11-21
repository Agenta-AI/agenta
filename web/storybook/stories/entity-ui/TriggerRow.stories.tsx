import {useState, type ReactNode} from "react"

import {TriggerRow} from "@agenta/entity-ui/drill-in"
import {DropdownMenuItem, DropdownMenuSeparator} from "@agenta/ui/ui"
import {Clock, ListChecks, PencilSimpleLine, Trash} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// TriggerRow — the Triggers section's standalone schedule row. The run action lives inside the
// ⋯ menu.
const meta = {
    title: "@agenta/entity-ui/DrillIn/TriggerRow",
    component: TriggerRow,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Standalone schedule row: status icon with a Radix Tooltip, name and subtitle, and a ⋯ actions `DropdownMenu` built from composed `DropdownMenuItem` JSX.",
            },
        },
    },
} satisfies Meta<typeof TriggerRow>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const MENU = (
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

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[11rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

const ICON = <Clock size={15} />

export const Variants: Story = {
    args: {
        icon: ICON,
        name: "Morning digest",
        subtitle: "Summarize yesterday's tickets.",
        active: true,
        onOpen: noop,
        menu: MENU,
    },
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="active · named">
                <TriggerRow
                    icon={ICON}
                    name="Morning digest"
                    subtitle="Summarize yesterday's tickets."
                    active
                    onOpen={noop}
                    menu={MENU}
                />
            </Row>
            <Row label="paused · unnamed (muted)">
                <TriggerRow
                    icon={ICON}
                    name="Untitled schedule"
                    nameMuted
                    subtitle="No message set"
                    active={false}
                    onOpen={noop}
                    menu={MENU}
                />
            </Row>
            <Row label="read-only">
                <TriggerRow
                    icon={ICON}
                    name="Weekly report"
                    subtitle="Post the weekly summary to #ops."
                    active
                    disabled
                    onOpen={noop}
                    menu={MENU}
                />
            </Row>
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
 * The row's "⋯" actions menu, forced open and rendered INLINE (`menuOpen` + `menuContainer`).
 * Both are real production features (rendering inside modals / scroll containers).
 */
export const OpenState: Story = {
    args: {
        icon: ICON,
        name: "Morning digest",
        subtitle: "Summarize yesterday's tickets.",
        active: true,
        onOpen: noop,
        menu: MENU,
    },
    render: () => (
        <div className="p-4">
            <Panel
                render={(c) => (
                    <TriggerRow
                        icon={ICON}
                        name="Morning digest"
                        subtitle="Summarize yesterday's tickets."
                        active
                        onOpen={noop}
                        menu={MENU}
                        menuOpen
                        menuContainer={c}
                    />
                )}
            />
        </div>
    ),
}
