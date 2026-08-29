/**
 * The proposal from the shortcut map, made real enough to press.
 *
 * Every story here renders shipping components, not sketches: the approval options drive the real
 * `ApprovalCard` through its new `shortcutHints` prop, and the sheet is the real
 * `KeyboardShortcutsSheet`. Picking a story is therefore the same as picking a default.
 */
import {useCallback, useState} from "react"

import {ApprovalCard} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"
import {KeyboardShortcutsSheet, ShortcutKeys, useShortcutsSheetHotkey} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "Playground/Keyboard shortcuts",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Forty-one keyboard bindings ship in the playground. Seven of them tell you they exist. These stories show where the other thirty-four would become visible.\n\nThree layers: keys on the control that already does the job (tooltips and menu rows), one sheet on `?` for the bindings no control can carry, and permanent keycaps on the two surfaces where a decision is owed.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const APPROVAL: PendingApproval[] = [
    {
        approvalId: "apr-1",
        toolName: "GITHUB_CREATE_ISSUE",
        input: {
            owner: "Agenta-AI",
            repo: "agenta",
            title: "Playground shortcut hints",
            body: "Surface the keyboard bindings on the controls that already do the job.",
        },
    },
]

const noop = () => undefined

const Frame = ({
    title,
    note,
    children,
}: {
    title: string
    note: string
    children: React.ReactNode
}) => (
    <section className="mb-8 flex max-w-[560px] flex-col gap-2">
        <h4 className="text-xs font-semibold text-colorText">{title}</h4>
        <p className="m-0 text-xs text-colorTextSecondary">{note}</p>
        <div className="mt-1">{children}</div>
    </section>
)

/**
 * Layer three, the one real taste call. Same card, same handlers, three values of `shortcutHints`.
 */
export const ApprovalCardOptions: Story = {
    render: () => (
        <div className="flex flex-col">
            <Frame
                title="Option A — keycaps inside the buttons"
                note="The key sits on the thing it presses. Costs about 46px of button width. Recommended."
            >
                <ApprovalCard
                    approvals={APPROVAL}
                    shortcutHints="buttons"
                    onRespond={noop}
                    onApproveAll={noop}
                    onDenyAll={noop}
                />
            </Frame>
            <Frame
                title="Option B — one hint line under the buttons"
                note="Buttons stay as they are today. Costs a row of height, and the link between key and button is implied rather than drawn."
            >
                <ApprovalCard
                    approvals={APPROVAL}
                    shortcutHints="line"
                    onRespond={noop}
                    onApproveAll={noop}
                    onDenyAll={noop}
                />
            </Frame>
            <Frame
                title="Option C — nothing on the card"
                note="What ships today. The keys exist but only a reader who opens the sheet ever learns them."
            >
                <ApprovalCard
                    approvals={APPROVAL}
                    shortcutHints="none"
                    onRespond={noop}
                    onApproveAll={noop}
                    onDenyAll={noop}
                />
            </Frame>
        </div>
    ),
}

/** Layer two. Press `?` anywhere on this story, or use the button. */
export const ShortcutsSheet: Story = {
    render: function Render() {
        const [open, setOpen] = useState(false)
        useShortcutsSheetHotkey(useCallback(() => setOpen(true), []))
        return (
            <div className="flex flex-col gap-3">
                <p className="m-0 max-w-[52ch] text-xs text-colorTextSecondary">
                    Press <ShortcutKeys chord={{key: "?"}} /> anywhere on this page. The hotkey is
                    matched on the produced character, so it works on a German or French layout
                    where <code>?</code> is not Shift+/.
                </p>
                <div>
                    <Button onClick={() => setOpen(true)}>Open the sheet</Button>
                </div>
                <KeyboardShortcutsSheet open={open} onOpenChange={setOpen} />
            </div>
        )
    },
}

/** Layer one. The keys ride on affordances the reader already hovers. */
export const Placements: Story = {
    render: () => (
        <div className="flex flex-col">
            <Frame title="Tooltips" note="Every control whose action has a key names it on hover.">
                <div className="flex flex-wrap items-center gap-2">
                    <SimpleTooltip
                        title={
                            <span className="flex items-center gap-1.5">
                                New session <ShortcutKeys id="session.new" tone="inverse" />
                            </span>
                        }
                    >
                        <Button variant="outline">+</Button>
                    </SimpleTooltip>
                    <SimpleTooltip
                        title={
                            <span className="flex items-center gap-1.5">
                                Show configuration{" "}
                                <ShortcutKeys id="session.config" tone="inverse" />
                            </span>
                        }
                    >
                        <Button variant="outline">Configuration</Button>
                    </SimpleTooltip>
                    <SimpleTooltip
                        title={
                            <span className="flex items-center gap-1.5">
                                Stop <ShortcutKeys id="run.stop" tone="inverse" />
                            </span>
                        }
                    >
                        <Button variant="outline">Stop</Button>
                    </SimpleTooltip>
                </div>
            </Frame>

            <Frame
                title="Session tab menu"
                note="A right-aligned key column, blank on the rows that have no key."
            >
                <div className="w-[260px] rounded-md border border-solid border-colorBorderSecondary bg-colorBgElevated p-1 shadow-md">
                    {[
                        {label: "Rename", id: "session.rename"},
                        {label: "Archive", id: "session.archive"},
                        {label: "Pin", id: undefined},
                        {label: "Close", id: "session.close"},
                        {label: "Close other tabs", id: undefined},
                    ].map((row) => (
                        <div
                            key={row.label}
                            className="flex items-center gap-3 rounded px-2.5 py-1.5 text-xs text-colorText hover:bg-colorFillTertiary"
                        >
                            <span className="flex-1">{row.label}</span>
                            {row.id ? <ShortcutKeys id={row.id} /> : null}
                        </div>
                    ))}
                </div>
            </Frame>

            <Frame
                title="One nudge for the session strip"
                note="Shown the first time a second session opens, then dismissed forever. It is the only teachable moment for the switching pair, which answers no control."
            >
                <div className="w-[420px] overflow-hidden rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer">
                    <div className="flex items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary p-1.5">
                        <span className="rounded bg-colorFillTertiary px-2.5 py-1 text-xs font-medium text-colorText">
                            Refund flow
                        </span>
                        <span className="px-2.5 py-1 text-xs text-colorTextSecondary">
                            Issue triage
                        </span>
                        <span className="ml-auto px-2 text-xs text-colorTextTertiary">+</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-colorTextSecondary">
                        <ShortcutKeys id="session.step" showAlt />
                        <span>switch sessions</span>
                        <span className="ml-auto text-colorTextTertiary">✕</span>
                    </div>
                </div>
            </Frame>
        </div>
    ),
}
