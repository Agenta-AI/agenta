import {AddSubagentDrawer, type SubagentOption} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The "pick the agents this agent can call" surface, sharing CatalogListRow,
// ExpandableDescription and LogoMarks with the integration drawer.
const meta = {
    title: "@agenta/entity-ui/DrillIn/AddSubagentDrawer",
    component: AddSubagentDrawer,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Add one or many agents as subagents. Each row adds itself and removes " +
                    "itself with the same button, Add all acts on what the search is " +
                    "showing, and the footer only closes.",
            },
        },
    },
} satisfies Meta<typeof AddSubagentDrawer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

// Copied from the generated agent-icon catalog, which is a 1300-line module.
const GLYPH = {
    headphones:
        '<path d="M201.89,54.66A103.43,103.43,0,0,0,128.79,24H128A104,104,0,0,0,24,128v56a24,24,0,0,0,24,24H64a24,24,0,0,0,24-24V144a24,24,0,0,0-24-24H40.36A88,88,0,0,1,128,40h.67a87.71,87.71,0,0,1,87,80H192a24,24,0,0,0-24,24v40a24,24,0,0,0,24,24h16a24,24,0,0,0,24-24V128A103.41,103.41,0,0,0,201.89,54.66ZM64,136a8,8,0,0,1,8,8v40a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V136Zm152,48a8,8,0,0,1-8,8H192a8,8,0,0,1-8-8V144a8,8,0,0,1,8-8h24Z"/>',
    "pen-nib":
        '<path d="M248,92.68a15.86,15.86,0,0,0-4.69-11.31L174.63,12.68a16,16,0,0,0-22.63,0L123.57,41.11l-58,21.77A16.06,16.06,0,0,0,55.35,75.23L32.11,214.68A8,8,0,0,0,40,224a8.4,8.4,0,0,0,1.32-.11l139.44-23.24a16,16,0,0,0,12.35-10.17l21.77-58L243.31,104A15.87,15.87,0,0,0,248,92.68Zm-69.87,92.19L63.32,204l47.37-47.37a28,28,0,1,0-11.32-11.32L52,192.7,71.13,77.86,126,57.29,198.7,130ZM112,132a12,12,0,1,1,12,12A12,12,0,0,1,112,132Zm96-15.32L139.31,48l24-24L232,92.68Z"/>',
    "magnifying-glass":
        '<path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>',
    shield: '<path d="M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.27,47,25.53a8,8,0,0,0,4.2,0c1-.26,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0Z"/>',
    "chart-line":
        '<path d="M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0v94.37L90.73,98a8,8,0,0,1,10.07-.38l58.81,44.11L218.73,90a8,8,0,1,1,10.54,12l-64,56a8,8,0,0,1-10.07.38L96.39,114.29,40,163.63V200H224A8,8,0,0,1,232,208Z"/>',
    bug: '<path d="M144,92a12,12,0,1,1,12,12A12,12,0,0,1,144,92ZM100,80a12,12,0,1,0,12,12A12,12,0,0,0,100,80Zm116,64A87.76,87.76,0,0,1,213,167l22.24,9.72A8,8,0,0,1,232,192a7.89,7.89,0,0,1-3.2-.67L207.38,182a88,88,0,0,1-158.76,0L27.2,191.33A7.89,7.89,0,0,1,24,192a8,8,0,0,1-3.2-15.33L43,167A87.76,87.76,0,0,1,40,144v-8H16a8,8,0,0,1,0-16H40v-8a87.76,87.76,0,0,1,3-23L20.8,79.33a8,8,0,1,1,6.4-14.66L48.62,74a88,88,0,0,1,158.76,0l21.42-9.36a8,8,0,0,1,6.4,14.66L213,89.05a87.76,87.76,0,0,1,3,23v8h24a8,8,0,0,1,0,16H216ZM56,120H200v-8a72,72,0,0,0-144,0Zm64,95.54V136H56v8A72.08,72.08,0,0,0,120,215.54ZM200,144v-8H136v79.54A72.08,72.08,0,0,0,200,144Z"/>',
    translate:
        '<path d="M247.15,212.42l-56-112a8,8,0,0,0-14.31,0l-21.71,43.43A88,88,0,0,1,108,126.93,103.65,103.65,0,0,0,135.69,64H160a8,8,0,0,0,0-16H104V32a8,8,0,0,0-16,0V48H32a8,8,0,0,0,0,16h87.63A87.76,87.76,0,0,1,96,116.35a87.74,87.74,0,0,1-19-31,8,8,0,1,0-15.08,5.34A103.63,103.63,0,0,0,84,127a87.55,87.55,0,0,1-52,17,8,8,0,0,0,0,16,103.46,103.46,0,0,0,64-22.08,104.18,104.18,0,0,0,51.44,21.31l-26.6,53.19a8,8,0,0,0,14.31,7.16L148.94,192h70.11l13.79,27.58A8,8,0,0,0,240,224a8,8,0,0,0,7.15-11.58ZM156.94,176,184,121.89,211.05,176Z"/>',
} as const
/** Palette entries from AGENT_ICON_COLORS, so the tinted chips match the picker's own swatches. */
const icon = (name: keyof typeof GLYPH, color: string) => ({name, color, path: GLYPH[name]})

// Inline marks, never a remote CDN: a story that reaches the network fails in CI.
const LOGO = {
    github: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Crect%20width%3D%2224%22%20height%3D%2224%22%20rx%3D%226%22%20fill%3D%22%2324292F%22%2F%3E%3Ctext%20x%3D%2212%22%20y%3D%2217%22%20font-family%3D%22system-ui%2Csans-serif%22%20font-size%3D%2214%22%20font-weight%3D%22600%22%20fill%3D%22%23fff%22%20text-anchor%3D%22middle%22%3EG%3C%2Ftext%3E%3C%2Fsvg%3E",
    slack: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Crect%20width%3D%2224%22%20height%3D%2224%22%20rx%3D%226%22%20fill%3D%22%234A154B%22%2F%3E%3Ctext%20x%3D%2212%22%20y%3D%2217%22%20font-family%3D%22system-ui%2Csans-serif%22%20font-size%3D%2214%22%20font-weight%3D%22600%22%20fill%3D%22%23fff%22%20text-anchor%3D%22middle%22%3ES%3C%2Ftext%3E%3C%2Fsvg%3E",
    linear: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Crect%20width%3D%2224%22%20height%3D%2224%22%20rx%3D%226%22%20fill%3D%22%235E6AD2%22%2F%3E%3Ctext%20x%3D%2212%22%20y%3D%2217%22%20font-family%3D%22system-ui%2Csans-serif%22%20font-size%3D%2214%22%20font-weight%3D%22600%22%20fill%3D%22%23fff%22%20text-anchor%3D%22middle%22%3EL%3C%2Ftext%3E%3C%2Fsvg%3E",
    notion: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Crect%20width%3D%2224%22%20height%3D%2224%22%20rx%3D%226%22%20fill%3D%22%230F0F0F%22%2F%3E%3Ctext%20x%3D%2212%22%20y%3D%2217%22%20font-family%3D%22system-ui%2Csans-serif%22%20font-size%3D%2214%22%20font-weight%3D%22600%22%20fill%3D%22%23fff%22%20text-anchor%3D%22middle%22%3EN%3C%2Ftext%3E%3C%2Fsvg%3E",
}

/** Past two lines at the drawer's width, which is what makes the Show more toggle appear. */
const LONG_DESCRIPTION =
    "Reads the full ticket thread including every attachment and prior escalation, decides the " +
    "severity against the current on-call policy, names the owning team, drafts the internal " +
    "summary, and posts it to the right channel so the on-call engineer has context before they " +
    "open the ticket."

const OPTIONS: SubagentOption[] = [
    {
        id: "wf-1",
        name: "Support triage",
        description:
            "Reads an incoming support ticket, decides its severity, and names the team that owns it.",
        icon: {...icon("headphones", "#0E7490"), icon: "headphones"},
        model: "claude-sonnet-4-5",
        provider: "Anthropic",
        integrations: [
            {key: "linear", name: "Linear", logo: LOGO.linear},
            {key: "slack", name: "Slack", logo: LOGO.slack},
        ],
    },
    {
        id: "wf-2",
        name: "Reply drafter",
        description: "Writes a first-draft reply in the team's voice, ready for a human to edit.",
        icon: {...icon("pen-nib", "#7C3AED"), icon: "pen-nib"},
        model: "claude-opus-4-1",
        provider: "Anthropic",
        integrations: [{key: "notion", name: "Notion", logo: null}],
    },
    {
        id: "wf-3",
        name: "Release researcher",
        description:
            "Searches the changelog and the open issues, then summarizes what shipped since a given version.",
        icon: {...icon("magnifying-glass", "#1668DC"), icon: "magnifying-glass"},
        model: "gpt-5",
        provider: "OpenAI",
        integrations: [{key: "github", name: "GitHub", logo: LOGO.github}],
    },
    {
        id: "wf-4",
        name: "Bug reproducer",
        description:
            "Turns a bug report into a minimal reproduction and reports whether it still fails.",
        icon: {...icon("bug", "#D61010"), icon: "bug"},
        model: "claude-sonnet-4-5",
        provider: "Anthropic",
        integrations: [],
    },
    {
        // No icon of its own: the card falls back to the robot glyph on a neutral chip.
        id: "wf-5",
        name: "Metrics reporter",
        description: "Pulls last week's numbers and writes the short version for the standup.",
        model: "gpt-5-mini",
        provider: "OpenAI",
        integrations: [{key: "github", name: "GitHub", logo: LOGO.github}],
    },
    {
        id: "wf-6",
        name: "Translator",
        description: "Rewrites a message in another language without losing the original tone.",
        icon: {...icon("translate", "#389E0D"), icon: "translate"},
        model: "claude-sonnet-4-5",
        provider: "Anthropic",
        integrations: [],
        added: true,
    },
]

// The drawer positions itself; `data-vrt-subject` is the harness's readiness marker.
const Frame = (children: React.ReactNode) => (
    <div data-vrt-subject className="h-screen w-full bg-[var(--ag-colorBgLayout)]">
        {children}
    </div>
)

/** Every row state the list can produce, in one screen. */
export const Default: Story = {
    args: {open: true, onClose: noop, options: OPTIONS, onAdd: noop, onRemove: noop},
    render: (args) => Frame(<AddSubagentDrawer {...args} />),
}

/** A short list, which is what a young project actually looks like. */
export const FewAgents: Story = {
    args: {open: true, onClose: noop, options: OPTIONS.slice(0, 2), onAdd: noop, onRemove: noop},
    render: (args) => Frame(<AddSubagentDrawer {...args} />),
}

/** Nothing to add yet. The copy points at the one thing that fixes it. */
export const NoAgents: Story = {
    args: {open: true, onClose: noop, options: [], onAdd: noop, onRemove: noop},
    render: (args) => Frame(<AddSubagentDrawer {...args} />),
}

/** First paint, before the project's agents resolve. */
export const Loading: Story = {
    args: {open: true, onClose: noop, options: [], loading: true, onAdd: noop, onRemove: noop},
    render: (args) => Frame(<AddSubagentDrawer {...args} />),
}

/** The clamp both ways, plus the row's worst case: long name, long model, four apps. */
export const LongContent: Story = {
    args: {
        open: true,
        onClose: noop,
        onAdd: noop,
        onRemove: noop,
        options: [
            {
                id: "wf-long-a",
                name: "Customer escalation triage and routing assistant for the support organization",
                description: LONG_DESCRIPTION,
                icon: {...icon("headphones", "#CA8A04"), icon: "headphones"},
                model: "claude-sonnet-4-5-20250929-preview",
                provider: "Anthropic",
                integrations: [
                    {key: "github", name: "GitHub", logo: LOGO.github},
                    {key: "slack", name: "Slack", logo: LOGO.slack},
                    {key: "linear", name: "Linear", logo: LOGO.linear},
                    {key: "notion", name: "Notion", logo: null},
                ],
            },
            {
                id: "wf-long-b",
                name: "Support triage",
                description: LONG_DESCRIPTION,
                icon: {...icon("headphones", "#0E7490"), icon: "headphones"},
                model: "claude-sonnet-4-5",
                provider: "Anthropic",
                integrations: [
                    {key: "linear", name: "Linear", logo: LOGO.linear},
                    {key: "slack", name: "Slack", logo: LOGO.slack},
                ],
            },
        ],
    },
    render: (args) => Frame(<AddSubagentDrawer {...args} />),
}

/** Every agent is already added, so every row offers Remove and the header drops Add all. */
export const AllAlreadyAdded: Story = {
    args: {
        open: true,
        onClose: noop,
        onAdd: noop,
        onRemove: noop,
        options: OPTIONS.map((o) => ({...o, added: true})),
    },
    render: (args) => Frame(<AddSubagentDrawer {...args} />),
}

/** Two agents failed to load. The list says so and offers a retry, rather than hiding them. */
export const SomeFailedToLoad: Story = {
    args: {
        open: true,
        onClose: noop,
        onAdd: noop,
        onRemove: noop,
        options: OPTIONS.slice(0, 3),
        failedCount: 2,
        onRetry: noop,
    },
    render: (args) => Frame(<AddSubagentDrawer {...args} />),
}
