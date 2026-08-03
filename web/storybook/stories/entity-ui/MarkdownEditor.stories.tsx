import {useState} from "react"

import {Badge} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag as AntTag} from "antd"

// Imported from source: the DrillInView barrel does not re-export this editor.
import {MarkdownEditor} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/MarkdownEditor"

// MarkdownEditor — the shared Lexical editor in Markdown mode (SKILL.md / AGENTS.md bodies),
// with a source ↔ rich-text toggle and an optional formatting toolbar. Its only antd import was
// the filename `Tag` in the plain header; everything else was already off antd.
//
// antd v6's DEFAULT Tag variant is `filled` (borderless) — so the `bordered` this call site
// passed was a no-op and the neutral `Badge` is the exact equivalent. The parity row proves it.
const meta = {
    title: "@agenta/entity-ui/DrillIn/MarkdownEditor",
    component: MarkdownEditor,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Markdown-aware editor (Lexical rich-text + markdown-source view). antd `Tag` (filename chip) → `@agenta/ui` `Badge`; the rest of the surface was already antd-free.",
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

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

/** The migrated markup — copied verbatim out of MarkdownEditor's `plainHeader`. */
const AgentaFilenameChip = ({filename}: {filename: string}) => (
    <Badge className="font-mono text-[11px] font-normal leading-[22.4px] text-[var(--ag-c-586673,#586673)]">
        {filename}
    </Badge>
)

/** The pre-migration markup (feat/storybook-data-seam) — `<Tag bordered …>`. */
const AntdFilenameChip = ({filename}: {filename: string}) => (
    <AntTag
        bordered
        className="m-0 font-mono text-[11px] font-normal text-[var(--ag-c-586673,#586673)]"
    >
        {filename}
    </AntTag>
)

const ViewToggle = () => (
    <span className="shrink-0 px-1 text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">Rich text</span>
)

/**
 * The one migrated piece is the filename chip in the editor's plain header — the antd half is the
 * pre-migration `<Tag bordered>`, the agenta half is MarkdownEditor's own `<Badge>` markup.
 * antd v6's default Tag variant is `filled` (borderless), so `bordered` never rendered a border
 * and the neutral Badge is the exact equivalent.
 */
export const AntdVsAgenta: Story = {
    args: {value: "", onChange: () => undefined, filename: "AGENTS.md"},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="filename chip"
                a={<AntdFilenameChip filename="AGENTS.md" />}
                s={<AgentaFilenameChip filename="AGENTS.md" />}
            />
            <Row
                label="header row"
                a={
                    <div className="flex w-full items-center justify-between gap-2">
                        <AntdFilenameChip filename="SKILL.md" />
                        <ViewToggle />
                    </div>
                }
                s={
                    <div className="flex w-full items-center justify-between gap-2">
                        <AgentaFilenameChip filename="SKILL.md" />
                        <ViewToggle />
                    </div>
                }
            />
        </div>
    ),
}
