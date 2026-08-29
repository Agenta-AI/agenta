import {PLAYGROUND_SHORTCUTS, SHORTCUT_GROUP_TITLES, shortcutGroups} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ShortcutKeys — keycaps for one keyboard shortcut, drawn from the shared registry rather than
// from a hand-written string, so a hint can never name a key the handler does not bind.
//
// The platform is read in a mount effect, never during render: the server has no platform and a
// guess mismatches on hydration. Until it lands the caps print the non-Apple faces, which is what
// `isMacPlatform()` already returns server-side.
const meta = {
    title: "@agenta/ui/Presentational/Labels/ShortcutKeys",
    component: ShortcutKeys,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Keycaps for one keyboard shortcut, printed the way the reader's own keyboard is labelled. The faces come from `PLAYGROUND_SHORTCUTS` in `@agenta/shared/utils`, so a hint can never name a key the handler does not bind. On Apple hardware the caps read `⌘ ⌥ ⌃ ⇧`; everywhere else they read `Ctrl Alt Shift`.\n\n**Used in:** 6 places — the approval card's Approve and Deny buttons, the configuration and files-pane tooltips, the shortcuts help button's tooltip, and every row of the shortcuts sheet.",
            },
        },
    },
} satisfies Meta<typeof ShortcutKeys>
export default meta
type Story = StoryObj<typeof meta>

/** The default: one registry id, rendered as the chip tone at the small size. */
export const Default: Story = {args: {id: "session.new"}}

/** `chip` sits on a surface. `inverse` sits inside a dark tooltip or a filled primary button. */
export const Tones: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 text-xs text-colorTextSecondary">
                <span className="w-24">chip</span>
                <ShortcutKeys id="approval.approve" />
                <ShortcutKeys id="session.step" showAlt />
            </div>
            <div className="flex items-center gap-3 rounded bg-colorText px-3 py-2 text-xs text-colorBgContainer">
                <span className="w-24">inverse</span>
                <ShortcutKeys id="approval.approve" tone="inverse" />
                <ShortcutKeys id="session.step" tone="inverse" showAlt />
            </div>
            <div className="flex items-center gap-3 text-xs text-colorTextSecondary">
                <span className="w-24">size md</span>
                <ShortcutKeys id="approval.approve" size="md" />
                <ShortcutKeys id="voice.hold" size="md" />
            </div>
        </div>
    ),
}

/** Every binding the playground ships, straight out of the registry. */
export const EveryBinding: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col gap-5">
            <p className="text-xs text-colorTextSecondary">
                {PLAYGROUND_SHORTCUTS.length} bindings, grouped by the surface that owns them.
            </p>
            {shortcutGroups()
                .filter((group) => group.shortcuts.length > 0)
                .map((group) => (
                    <section key={group.id}>
                        <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-colorTextTertiary">
                            {SHORTCUT_GROUP_TITLES[group.id]}
                        </h4>
                        {group.shortcuts.map((shortcut) => (
                            <div
                                key={shortcut.id}
                                className="flex items-center gap-3 border-0 border-b border-solid border-colorBorderSecondary py-1.5 text-xs text-colorTextSecondary"
                            >
                                <span className="flex-1">
                                    {shortcut.label}
                                    {shortcut.when ? (
                                        <span className="text-colorTextTertiary">
                                            {" "}
                                            — {shortcut.when}
                                        </span>
                                    ) : null}
                                </span>
                                <code className="text-[10px] text-colorTextTertiary">
                                    {shortcut.id}
                                </code>
                                <ShortcutKeys id={shortcut.id} showAlt />
                            </div>
                        ))}
                    </section>
                ))}
        </div>
    ),
}
