import {useState} from "react"

import {Badge} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export this editor.
import {MarkdownEditor} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/MarkdownEditor"

// MarkdownEditor — the shared Lexical editor in Markdown mode (SKILL.md / AGENTS.md bodies),
// with a source ↔ rich-text toggle and an optional formatting toolbar.
const meta = {
    title: "@agenta/entity-ui/DrillIn/MarkdownEditor",
    component: MarkdownEditor,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Markdown-aware editor (Lexical rich-text + markdown-source view) with a filename chip, a view toggle, and an optional formatting toolbar.",
            },
        },
    },
} satisfies Meta<typeof MarkdownEditor>

export default meta
type Story = StoryObj<typeof meta>

const SAMPLE = `# Role

You are a support triage agent.

## Guardrails

- Never share internal data.
- Ask one clarifying question when a request is ambiguous.

\`\`\`json
{"escalate": true}
\`\`\`
`

const Live = (props: Partial<React.ComponentProps<typeof MarkdownEditor>>) => {
    const [value, setValue] = useState(SAMPLE)
    return (
        <div className="max-w-[640px]">
            <MarkdownEditor value={value} onChange={setValue} {...props} />
        </div>
    )
}

/** Default: bordered editor with the built-in filename/toggle header, source view. */
export const Default: Story = {
    args: {value: SAMPLE, onChange: () => undefined, filename: "AGENTS.md"},
    render: () => <Live filename="AGENTS.md" />,
}

/** Rendered (rich-text) view with the formatting toolbar — the drawer's editing surface. */
export const WithToolbar: Story = {
    args: {value: SAMPLE, onChange: () => undefined},
    render: () => <Live showToolbar defaultView="rendered" hideHeader maxHeight={320} />,
}

/** Read-only preview pane (`editable={false}`, no border, no header). */
export const Preview: Story = {
    args: {value: SAMPLE, onChange: () => undefined},
    render: () => (
        <Live view="rendered" editable={false} hideHeader bordered={false} maxHeight={320} />
    ),
}

/** Disabled — the editor and the view toggle both refuse input. */
export const Disabled: Story = {
    args: {value: SAMPLE, onChange: () => undefined, disabled: true},
    render: () => <Live filename="SKILL.md" disabled />,
}

/** No filename — the header keeps only the view toggle (right-aligned). */
export const NoFilename: Story = {
    args: {value: SAMPLE, onChange: () => undefined},
    render: () => <Live />,
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <div className="flex-1">{children}</div>
        </div>
    </div>
)

/** The filename chip, copied out of MarkdownEditor's `plainHeader`. */
const FilenameChip = ({filename}: {filename: string}) => (
    <Badge className="font-mono text-[11px] font-normal leading-[22.4px] text-[var(--ag-c-586673,#586673)]">
        {filename}
    </Badge>
)

const ViewToggle = () => (
    <span className="shrink-0 px-1 text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">Rich text</span>
)

/** The filename chip in the editor's plain header. */
export const Variants: Story = {
    args: {value: "", onChange: () => undefined, filename: "AGENTS.md"},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="filename chip">
                <FilenameChip filename="AGENTS.md" />
            </Row>
            <Row label="header row">
                <div className="flex w-full items-center justify-between gap-2">
                    <FilenameChip filename="SKILL.md" />
                    <ViewToggle />
                </div>
            </Row>
        </div>
    ),
}
