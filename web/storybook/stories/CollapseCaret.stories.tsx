import {useState} from "react"

import {CollapseCaret} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// No antd counterpart: one shared glyph, so this is a one-column showcase rather than a parity grid.
const meta = {
    title: "@agenta/ui/Primitives/Display/CollapseCaret",
    component: CollapseCaret,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The one collapse and expand caret. A filled right caret that turns 90° to point down when open. Pass `open`, or leave it undefined under a parent that rotates `[data-slot=collapse-caret]` from its own `data-state` (the accordion does this).\n\n**Used in:** every shared collapse and expand control in `@agenta/ui` and `@agenta/chat`.",
            },
        },
    },
    args: {open: false, size: 12},
} satisfies Meta<typeof CollapseCaret>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-6" data-vrt-subject>
            {children}
        </div>
    </div>
)

export const Showcase: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="closed · 10 / 12 / 14">
                <CollapseCaret size={10} />
                <CollapseCaret size={12} />
                <CollapseCaret size={14} />
            </Row>
            <Row label="open · 10 / 12 / 14">
                <CollapseCaret open size={10} />
                <CollapseCaret open size={12} />
                <CollapseCaret open size={14} />
            </Row>
            <Row label="14px column, closed and open">
                {[false, true].map((open) => (
                    <span
                        key={String(open)}
                        className="flex size-[14px] items-center justify-center outline outline-1 outline-colorBorderSecondary"
                    >
                        <CollapseCaret open={open} size={14} />
                    </span>
                ))}
            </Row>
        </div>
    ),
}

/** A header row as the config sections draw it: title on the left, caret in the 14px column. */
export const HeaderRow: Story = {
    render: function HeaderRowStory() {
        const [open, setOpen] = useState(false)
        return (
            <div className="max-w-[420px] rounded border border-solid border-colorBorderSecondary">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-4 py-3 text-left font-[inherit] text-sm font-medium text-colorText"
                >
                    <span>Instructions</span>
                    <span className="flex size-[14px] items-center justify-center">
                        <CollapseCaret open={open} size={14} />
                    </span>
                </button>
                {open ? (
                    <div className="border-0 border-t border-solid border-colorBorderSecondary px-4 py-3 text-xs text-colorTextSecondary">
                        The section body.
                    </div>
                ) : null}
            </div>
        )
    },
}
