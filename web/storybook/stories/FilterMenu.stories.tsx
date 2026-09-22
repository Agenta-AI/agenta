import {useState} from "react"

import {FilterMenu, type FilterMenuItem} from "@agenta/ui/filter-menu"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Archive,
    Bot,
    CalendarClock,
    Clock,
    Layers,
    LayoutList,
    Minus,
    Rows3,
    Type,
    Zap,
} from "lucide-react"

/**
 * `@agenta/ui/filter-menu` is antd-free and entity-free, so it renders identically in `/m` and
 * the desktop app. Nothing type-checks the storybook package in CI — these stories are the only
 * place the component's prop shape is exercised outside its two call-sites.
 */
const meta = {
    title: "@agenta/ui/Patterns/FilterMenu",
    component: FilterMenu,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "One popover holding a surface's whole view configuration: filters above a divider, sort and group below it, search over the lot, reset beneath.\n\nEvery row is declared in `sections` — omitting a section is how a consumer turns that control off. All row and option icons arrive as `ReactNode` props, so the component never picks an icon set for its host.\n\n**Used in:** `web/mobile` automations list (`AutomationFilterMenu`).",
            },
        },
    },
} satisfies Meta<typeof FilterMenu>
export default meta
type Story = StoryObj<typeof FilterMenu>

const ICON = 14

interface View {
    type: string
    agent: string
    status: string
    sort: string
    group: string
    archived: boolean
}

const INITIAL: View = {
    type: "chat",
    agent: "all",
    status: "all",
    sort: "activity",
    group: "none",
    archived: false,
}

const buildSections = (
    view: View,
    set: (patch: Partial<View>) => void,
    {withGroup = true, emptyAgents = false} = {},
): FilterMenuItem[] => {
    const sections: FilterMenuItem[] = [
        {
            key: "type",
            label: "Type",
            icon: <Zap size={ICON} />,
            value: view.type,
            options: [
                {value: "all", label: "All", icon: <Layers size={ICON} />},
                {value: "chat", label: "Chat", icon: <Type size={ICON} />},
                {value: "automation", label: "Automation", icon: <Zap size={ICON} />},
            ],
            onChange: (type) => set({type}),
        },
        {
            key: "agent",
            label: "Agent",
            icon: <Bot size={ICON} />,
            value: view.agent,
            emptyText: "No agents yet",
            options: emptyAgents
                ? []
                : [
                      {value: "all", label: "All agents", icon: <Bot size={ICON} />},
                      {value: "triage", label: "Issue triager", icon: <Bot size={ICON} />},
                      {value: "changelog", label: "Changelog writer", icon: <Bot size={ICON} />},
                  ],
            onChange: (agent) => set({agent}),
        },
        {
            key: "status",
            label: "Status",
            icon: <LayoutList size={ICON} />,
            value: view.status,
            options: [
                {value: "all", label: "All", icon: <Layers size={ICON} />},
                {value: "working", label: "Working", icon: <Clock size={ICON} />},
                {value: "paused", label: "Paused", icon: <Minus size={ICON} />},
            ],
            onChange: (status) => set({status}),
        },
        {
            kind: "toggle",
            key: "archived",
            label: "Only archived",
            icon: <Archive size={ICON} />,
            checked: view.archived,
            onChange: (archived) => set({archived}),
        },
        {
            key: "sort",
            label: "Sort by",
            icon: <CalendarClock size={ICON} />,
            block: "sort",
            value: view.sort,
            options: [
                {value: "activity", label: "Last activity", icon: <Clock size={ICON} />},
                {value: "name", label: "Name", icon: <Type size={ICON} />},
            ],
            onChange: (sort) => set({sort}),
        },
    ]

    if (withGroup) {
        sections.push({
            key: "group",
            label: "Group by",
            icon: <Rows3 size={ICON} />,
            block: "sort",
            value: view.group,
            options: [
                {value: "none", label: "None", icon: <Minus size={ICON} />},
                {value: "type", label: "Type", icon: <Zap size={ICON} />},
                {value: "agent", label: "Agent", icon: <Bot size={ICON} />},
            ],
            onChange: (group) => set({group}),
        })
    }

    return sections
}

const Harness = ({
    withGroup,
    emptyAgents,
    ...props
}: {withGroup?: boolean; emptyAgents?: boolean} & Partial<
    React.ComponentProps<typeof FilterMenu>
>) => {
    const [view, setView] = useState(INITIAL)
    const set = (patch: Partial<View>) => setView((current) => ({...current, ...patch}))
    return (
        <FilterMenu
            sections={buildSections(view, set, {withGroup, emptyAgents})}
            onReset={() => setView(INITIAL)}
            {...props}
        />
    )
}

/** The default: outline trigger, icon + word, panel below, flyouts to the right. */
export const Default: Story = {render: () => <Harness />}

/** `label={null}` collapses the trigger to its glyph — pass `triggerAriaLabel` with it. */
export const IconOnlyTrigger: Story = {
    render: () => <Harness label={null} triggerAriaLabel="Filter automations" />,
}

/** Omitting the group section is the whole of turning grouping off — there is no `showGroup`. */
export const NoGroupSection: Story = {render: () => <Harness withGroup={false} />}

/** `flyoutSide="left"` for a trigger that lives on a right-hand rail or a drawer edge. */
export const LeftPlacedFlyout: Story = {
    render: () => <Harness align="end" flyoutSide="left" flyoutAlign="start" />,
}

/** A search that matches nothing — designed, not an empty box. */
export const EmptySearch: Story = {
    render: () => <Harness defaultSearch="zzz" />,
}

/** A section whose options have not arrived yet still says so inside its flyout. */
export const EmptySection: Story = {render: () => <Harness emptyAgents />}

const WithoutReset = () => {
    const [view, setView] = useState(INITIAL)
    const set = (patch: Partial<View>) => setView((current) => ({...current, ...patch}))
    return <FilterMenu sections={buildSections(view, set)} />
}

/** No `onReset` hides the reset; the Esc hint stays. */
export const NoReset: Story = {render: () => <WithoutReset />}
