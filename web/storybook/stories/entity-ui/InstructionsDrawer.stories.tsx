import {useState} from "react"

import {
    Button,
    Segmented,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {ArrowsOut} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Not exported from `@agenta/entity-ui/drill-in` (AgentTemplateControl is its only consumer), so
// the story imports the source directly — the same relative-import convention the @agenta/ui
// primitive stories use for unbarrelled components.
import {InstructionsDrawer} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/InstructionsDrawer"

// InstructionsDrawer — the markdown editor drawer for one instructions file (AGENTS.md).
//
// The drawer portals to `body`, so the state stories are SHOWCASES; `Variants` renders the
// header/footer chrome inline.
const meta = {
    title: "@agenta/entity-ui/DrillIn/InstructionsDrawer",
    component: InstructionsDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Edit/Preview drawer for one instructions markdown file. Draft-then-save: the host owns the draft, the drawer reports via `onChange` and commits via `onSave`.",
            },
        },
    },
} satisfies Meta<typeof InstructionsDrawer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const SAMPLE = `# Role

You triage inbound support requests and route them to the right team.

## Guardrails

- Never share internal data or credentials.
- Ask one clarifying question when a request is ambiguous.
`

const DrawerDemo = ({filename = "AGENTS.md", disabled = false}) => {
    const [open, setOpen] = useState(true)
    const [value, setValue] = useState(SAMPLE)
    return (
        <div className="p-4">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Open instructions drawer
            </Button>
            <InstructionsDrawer
                open={open}
                filename={filename}
                value={value}
                onChange={setValue}
                onCancel={() => setOpen(false)}
                onSave={() => setOpen(false)}
                disabled={disabled}
                dirty={value !== SAMPLE}
            />
        </div>
    )
}

/** Edit mode — MarkdownEditor with the formatting toolbar, plus the AGENTS.md guidance rail. */
export const Default: Story = {
    args: {
        open: true,
        filename: "AGENTS.md",
        value: SAMPLE,
        onChange: noop,
        onCancel: noop,
        onSave: noop,
    },
    render: () => <DrawerDemo />,
}

/** A non-AGENTS.md file — the "Writing a good AGENTS.md" card is omitted. */
export const OtherFile: Story = {
    args: Default.args,
    render: () => <DrawerDemo filename="SKILL.md" />,
}

/** Read-only (a committed revision) — Save disabled, suggestion chips disabled. */
export const Disabled: Story = {
    args: Default.args,
    render: () => <DrawerDemo disabled />,
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <div className="flex-1">{children}</div>
        </div>
    </div>
)

const MODE_OPTIONS = [
    {label: "Edit", value: "edit"},
    {label: "Preview", value: "preview"},
]

const EXPAND_BTN_CLASS =
    "absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] bg-[var(--ag-c-FFFFFF,#fff)] text-[var(--ag-c-586673,#586673)] hover:border-[var(--ag-c-97A4B0,#97a4b0)]"

const FooterNote = () => (
    <span className="text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">Draft — applies on save</span>
)

export const Variants: Story = {
    args: Default.args,
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row label="mode toggle">
                <Segmented value="edit" options={MODE_OPTIONS} aria-label="Editor mode" />
            </Row>
            <Row label="footer">
                <div className="flex items-center justify-between gap-3">
                    <FooterNote />
                    <div className="flex shrink-0 items-center gap-2">
                        <Button variant="outline">Cancel</Button>
                        <Button variant="default">Save</Button>
                    </div>
                </div>
            </Row>
            <Row label="footer (disabled save)">
                <div className="flex items-center justify-between gap-3">
                    <FooterNote />
                    <div className="flex shrink-0 items-center gap-2">
                        <Button variant="outline">Cancel</Button>
                        <Button variant="default" disabled>
                            Save
                        </Button>
                    </div>
                </div>
            </Row>
            <Row label="expand button (tooltip trigger)">
                <div className="relative h-11 w-24">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Expand preview"
                                    className={EXPAND_BTN_CLASS}
                                >
                                    <ArrowsOut size={14} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>Expand</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </Row>
        </div>
    ),
}
