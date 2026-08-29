/**
 * The proposal from the shortcut map, made real enough to press.
 *
 * Every story here renders shipping components, not sketches: the approval card is the real
 * `ApprovalCard`, the sheet and its button are the real `ShortcutsHelpButton`, and the two panel
 * tooltips read their keys from the same registry the handlers are written against.
 */
import {ApprovalCard} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"
import {KeyboardShortcutsSheet, ShortcutKeys, ShortcutsHelpButton} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {CaretDoubleLeft, CaretDoubleRight, GearSix, Robot} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Domain/KeyboardShortcuts",
    component: ShortcutsHelpButton,
    subcomponents: {KeyboardShortcutsSheet, ShortcutKeys},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Forty-three keyboard shortcuts ship in the agent playground. Six of them tell you they exist. These stories show where the rest become visible.\n\nTwo layers: keys on the control that already does the job, and one sheet on `?` for the shortcuts no control can carry. The letters avoid every browser menu key, so the same bindings work on Windows, Linux and macOS.\n\n**Used in:** 1 place — the playground top bar (`PlaygroundHeader`), rightmost after the settings gear.",
            },
        },
    },
} satisfies Meta<typeof ShortcutsHelpButton>
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
 * The approval card is the surface where a keyboard answer is genuinely faster than a mouse, and
 * where a mis-press costs the most, so the keys stay on screen instead of hiding in a tooltip.
 */
export const ApprovalCardKeys: Story = {
    render: () => (
        <Frame
            title="Approval card"
            note="The key sits on the button it presses. Touch drops both keycaps, because a touch reader has no keyboard."
        >
            <ApprovalCard
                approvals={APPROVAL}
                onRespond={noop}
                onApproveAll={noop}
                onDenyAll={noop}
            />
        </Frame>
    ),
}

/**
 * The sheet and its button ship together: a hotkey with no button teaches nobody.
 */
export const ShortcutsSheet: Story = {
    render: () => (
        <div className="flex flex-col gap-5">
            <Frame
                title="The button, at the right edge of the playground top bar"
                note="The last control in the bar, after the settings gear. Hover it to see the key; click it to open the sheet."
            >
                <div className="flex w-[520px] items-center justify-between gap-4 rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer px-2.5 py-2">
                    <span className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-colorFillSecondary">
                            <Robot size={15} weight="fill" />
                        </span>
                        <span className="text-[16px] font-semibold text-colorText">
                            Refund agent
                        </span>
                    </span>
                    <span className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" aria-label="Playground settings">
                            <GearSix size={16} />
                        </Button>
                        <ShortcutsHelpButton className="h-8 w-8 shrink-0 p-0" />
                    </span>
                </div>
            </Frame>
            <Frame
                title="The hotkey"
                note="Press ? anywhere on this page. It is ignored while the caret is in a text field, so typing a question mark in the composer stays a question mark. It matches the produced character, so it also works where ? is Shift+ß or Shift+comma."
            >
                <p className="m-0 flex items-center gap-1.5 text-xs text-colorTextSecondary">
                    Try it now: <ShortcutKeys id="help.sheet" />
                </p>
            </Frame>
        </div>
    ),
}

/**
 * The keys ride on affordances the reader already hovers. Only the two side panels are wired in
 * this change; the session tab menu, the search box and the stop button are listed as follow-up
 * in docs/design/playground-shortcut-discoverability/status.md.
 */
export const PanelTooltips: Story = {
    render: () => (
        <div className="flex flex-col">
            <Frame
                title="The two side panels"
                note="Each caret names its own key on hover, and carries it as aria-keyshortcuts for a screen reader. Alt+C shows or hides the configuration; Alt+O shows or hides the files pane."
            >
                <div className="flex items-center gap-3">
                    <SimpleTooltip
                        title={
                            <span className="flex items-center gap-1.5">
                                Show configuration <ShortcutKeys id="panel.config" tone="inverse" />
                            </span>
                        }
                    >
                        <Button variant="ghost" size="icon-sm" className="h-7 w-7 p-0">
                            <CaretDoubleRight size={14} />
                        </Button>
                    </SimpleTooltip>
                    <SimpleTooltip
                        title={
                            <span className="flex items-center gap-1.5">
                                Show files <ShortcutKeys id="panel.files" tone="inverse" />
                            </span>
                        }
                    >
                        <Button variant="ghost" size="icon-sm" className="h-7 w-7 p-0">
                            <CaretDoubleLeft size={14} />
                        </Button>
                    </SimpleTooltip>
                </div>
            </Frame>
        </div>
    ),
}
