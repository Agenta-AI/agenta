import {useState} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {NavMenu} from "@agenta/navigation-ui"
import {ChartBar, House, Lightning, Robot, SquaresFour, Sparkle} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const icon = (Icon: typeof House) => <Icon size={16} />

const PAGES: SidebarConfig[] = [
    {key: "home", title: "Home", link: "#home", icon: icon(House)},
    {key: "agents", title: "Agents", link: "#agents", icon: icon(Robot)},
    {key: "automations", title: "Automations", link: "#automations", icon: icon(Lightning)},
    {key: "skills", title: "Skills", link: "#skills", icon: icon(Sparkle)},
    {key: "templates", title: "Templates", link: "#templates", icon: icon(SquaresFour)},
    {
        key: "evaluation",
        title: "Evaluation",
        icon: icon(ChartBar),
        submenu: [
            {key: "testsets", title: "Test sets", link: "#testsets"},
            {key: "evaluators", title: "Evaluators", link: "#evaluators"},
        ],
    },
]

const byKey = new Map(PAGES.map((page) => [page.key, page]))
const pick = (keys: string[]) => keys.flatMap((key) => byKey.get(key) ?? [])

const Sidebar = ({
    visible: initialVisible,
    hidden: initialHidden,
    collapsed,
}: {
    visible: string[]
    hidden: string[]
    collapsed: boolean
}) => {
    const [layout, setLayout] = useState({visible: initialVisible, hidden: initialHidden})
    return (
        <div
            className="bg-[var(--ag-sidebar-bg)] py-2"
            style={{width: collapsed ? 48 : 240, minHeight: 360}}
        >
            <NavMenu
                items={pick(layout.visible)}
                collapsed={collapsed}
                arrange={{
                    hidden: pick(layout.hidden),
                    onArrange: (visible, hidden) => setLayout({visible, hidden}),
                    onReset: () => setLayout({visible: initialVisible, hidden: initialHidden}),
                }}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/navigation-ui/ArrangeablePages",
    component: Sidebar,
    parameters: {layout: "padded"},
    args: {
        visible: ["home", "agents", "automations", "skills"],
        hidden: ["templates", "evaluation"],
        collapsed: false,
    },
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

/** Drag rows to reorder; drop one on More to hide it. More lists Templates and the Evaluation group. */
export const Default: Story = {}

/** Nothing is hidden: More shows its empty state. */
export const AllVisible: Story = {
    args: {visible: PAGES.map((page) => page.key), hidden: []},
}

/** One page left: dragging it onto More reads "Keep one page here" and does nothing. */
export const OnePageLeft: Story = {
    args: {visible: ["home"], hidden: PAGES.slice(1).map((page) => page.key)},
}

/** The icon rail: More opens as a popover. */
export const Collapsed: Story = {args: {collapsed: true}}
