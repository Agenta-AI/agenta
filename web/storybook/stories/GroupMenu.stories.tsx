import {useState} from "react"

import {GroupMenu} from "@agenta/ui/filter-menu"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Bot, Minus, Zap} from "lucide-react"

/**
 * The smaller sibling of `FilterMenu`, for a surface that wants a standalone group control rather
 * than a Group row inside the filter panel. It renders the same option list the flyouts do.
 */
const meta = {
    title: "@agenta/ui/Patterns/GroupMenu",
    component: GroupMenu,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "A single option list in a popover — the `FilterMenu` flyout's own list, so check marks, empty states and arrow-key behaviour cannot drift between the two.",
            },
        },
    },
} satisfies Meta<typeof GroupMenu>
export default meta
type Story = StoryObj<typeof GroupMenu>

const ICON = 14

const OPTIONS = [
    {value: "none", label: "None", icon: <Minus size={ICON} />},
    {value: "type", label: "Type", icon: <Zap size={ICON} />},
    {value: "agent", label: "Agent", icon: <Bot size={ICON} />},
]

const Harness = (props: Partial<React.ComponentProps<typeof GroupMenu>>) => {
    const [value, setValue] = useState("none")
    return (
        <GroupMenu
            options={OPTIONS}
            value={value}
            onChange={setValue}
            onReset={value === "none" ? undefined : () => setValue("none")}
            {...props}
        />
    )
}

/** The default: outline trigger, icon + the word "Group". */
export const Default: Story = {render: () => <Harness />}

/** `label={null}` for a dense toolbar. */
export const IconOnlyTrigger: Story = {
    render: () => <Harness label={null} triggerAriaLabel="Group sessions" />,
}

/** `searchable` adds a field over the options; a term that matches nothing is designed. */
export const EmptySearch: Story = {
    render: () => <Harness searchable defaultSearch="zzz" />,
}

/** Nothing to group by — the panel says so rather than rendering an empty box. */
export const NoOptions: Story = {
    render: () => <Harness options={[]} />,
}

/** `side`/`align` aim it — here from a right-hand rail. */
export const LeftPlaced: Story = {
    render: () => <Harness side="left" align="start" />,
}
