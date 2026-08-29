/**
 * One registry for every keyboard binding the agent playground ships.
 *
 * The bindings themselves are declared in six different files (`useSessionShortcuts`,
 * `AgentConversation`, `SubmitPlugin`, `useRovingList`, `ApprovalCard`, `ConnectionDock`,
 * `ElicitationDock`, `usePushToTalk`). Nothing named them on screen, so nothing could drift.
 * Now that tooltips, menus and a shortcuts sheet all print the keys, they read them from here.
 */
import {isMacPlatform} from "./platform"

/** A modifier, named by role rather than by glyph — the glyph differs per platform. */
export type ShortcutModifier = "mod" | "alt" | "ctrl" | "shift"

/** Apple hardware prints glyphs; everything else prints words. */
const MODIFIER_FACE: Record<ShortcutModifier, {mac: string; other: string}> = {
    mod: {mac: "⌘", other: "Ctrl"},
    alt: {mac: "⌥", other: "Alt"},
    ctrl: {mac: "⌃", other: "Ctrl"},
    shift: {mac: "⇧", other: "Shift"},
}

export interface Shortcut {
    /** Stable id, used by a hint to look up the keys it must print. */
    id: string
    group: ShortcutGroupId
    /** What the shortcut does, in the words a user would use. */
    label: string
    modifiers?: ShortcutModifier[]
    /** The key face, already display-ready: `Z`, `1…9`, `↵`, `Esc`. */
    key: string
    /** A second chord that does the mirror action, e.g. next against previous. */
    alt?: {modifiers?: ShortcutModifier[]; key: string}
    /** When the binding only answers under a condition, say so in one clause. */
    when?: string
}

export type ShortcutGroupId =
    | "sessions"
    | "panels"
    | "run"
    | "composer"
    | "picker"
    | "approval"
    | "connection"
    | "elicitation"
    | "voice"
    | "rename"
    | "help"

export const SHORTCUT_GROUP_TITLES: Record<ShortcutGroupId, string> = {
    sessions: "Sessions",
    panels: "Side panels",
    run: "While the agent runs",
    composer: "Composer",
    picker: "Command picker",
    approval: "Approval card",
    connection: "Connection dock",
    elicitation: "Forms the agent asks",
    voice: "Voice",
    rename: "Renaming a session",
    help: "Help",
}

export const PLAYGROUND_SHORTCUTS: readonly Shortcut[] = [
    // Sessions — useSessionShortcuts.ts
    {
        id: "session.jump",
        group: "sessions",
        label: "Go to session 1 to 9",
        modifiers: ["alt"],
        key: "1…9",
    },
    {
        id: "session.step",
        group: "sessions",
        label: "Previous or next session",
        modifiers: ["alt"],
        key: "Z",
        alt: {modifiers: ["alt"], key: "X"},
    },
    {id: "session.new", group: "sessions", label: "New session", modifiers: ["alt"], key: "N"},
    {
        id: "session.close",
        group: "sessions",
        label: "Close the session",
        modifiers: ["alt"],
        key: "W",
        when: "two or more are open",
    },
    {
        id: "session.rename",
        group: "sessions",
        label: "Rename the session",
        modifiers: ["alt"],
        key: "R",
    },
    {
        id: "session.archive",
        group: "sessions",
        label: "Archive the session",
        modifiers: ["alt"],
        key: "A",
    },
    {
        id: "session.search",
        group: "sessions",
        label: "Search sessions",
        modifiers: ["alt"],
        key: "K",
    },

    // Side panels — ShowConfigPanelButton.tsx, OpenFilesPaneButton.tsx
    {
        id: "panel.config",
        group: "panels",
        label: "Show or hide the configuration",
        modifiers: ["alt"],
        key: "C",
    },
    {
        id: "panel.files",
        group: "panels",
        label: "Show or hide the files pane",
        modifiers: ["alt"],
        key: "O",
    },

    // The running turn — AgentConversation.tsx
    {
        id: "run.stop",
        group: "run",
        label: "Stop the turn",
        key: "Esc",
        when: "the agent is running",
    },
    {
        id: "run.approve",
        group: "run",
        label: "Approve the first parked gate",
        modifiers: ["alt"],
        key: "G",
    },

    // Composer — RichChatInput / SubmitPlugin
    {id: "composer.send", group: "composer", label: "Send", key: "↵"},
    {id: "composer.newline", group: "composer", label: "New line", modifiers: ["shift"], key: "↵"},
    {id: "composer.newlineMod", group: "composer", label: "New line", modifiers: ["mod"], key: "↵"},
    {id: "composer.bold", group: "composer", label: "Bold", modifiers: ["mod"], key: "B"},
    {id: "composer.italic", group: "composer", label: "Italic", modifiers: ["mod"], key: "I"},
    {id: "composer.commands", group: "composer", label: "Open commands", key: "/"},

    // Command picker — useRovingList.ts
    {id: "picker.move", group: "picker", label: "Move through the list", key: "↑", alt: {key: "↓"}},
    {
        id: "picker.ends",
        group: "picker",
        label: "First or last item",
        key: "Home",
        alt: {key: "End"},
    },
    {id: "picker.pick", group: "picker", label: "Pick the item", key: "↵"},
    {id: "picker.back", group: "picker", label: "Back to the command list", key: "←"},
    {id: "picker.dismiss", group: "picker", label: "Close the picker", key: "Esc"},

    // Approval card — ApprovalCard.tsx
    {id: "approval.approve", group: "approval", label: "Approve", modifiers: ["mod"], key: "↵"},
    {id: "approval.deny", group: "approval", label: "Deny", key: "Esc"},

    // Connection dock — ConnectionDock.tsx
    {id: "connection.connect", group: "connection", label: "Connect", modifiers: ["mod"], key: "↵"},
    {
        id: "connection.decline",
        group: "connection",
        label: "Decline, or cancel the popup",
        key: "Esc",
    },

    // Elicitation dock — ElicitationDock.tsx and its controls
    {
        id: "form.next",
        group: "elicitation",
        label: "Next step, or submit",
        modifiers: ["mod"],
        key: "↵",
    },
    {
        id: "form.step",
        group: "elicitation",
        label: "Back or forward one step",
        modifiers: ["mod"],
        key: "←",
        alt: {modifiers: ["mod"], key: "→"},
    },
    {id: "form.skip", group: "elicitation", label: "Skip the step", modifiers: ["mod"], key: "⌫"},
    {id: "form.pick", group: "elicitation", label: "Pick option 1 to 9", key: "1…9"},
    {id: "form.move", group: "elicitation", label: "Move the cursor", key: "↑", alt: {key: "↓"}},
    {
        id: "form.ends",
        group: "elicitation",
        label: "First or last option",
        key: "Home",
        alt: {key: "End"},
    },
    {
        id: "form.toggle",
        group: "elicitation",
        label: "Toggle the option",
        key: "Space",
        when: "many can be picked",
    },
    {id: "form.enter", group: "elicitation", label: "Pick the option under the cursor", key: "↵"},
    {id: "form.escape", group: "elicitation", label: "Leave the field", key: "Esc"},
    {id: "form.chipAdd", group: "elicitation", label: "Add a chip", key: "↵", alt: {key: ","}},
    {
        id: "form.chipRemove",
        group: "elicitation",
        label: "Remove the last chip",
        key: "⌫",
        when: "the field is empty",
    },

    // Voice — usePushToTalk.ts, RecordingBar.tsx
    {
        id: "voice.hold",
        group: "voice",
        label: "Hold to dictate, release to stop",
        modifiers: ["ctrl", "alt"],
        key: "",
    },
    {id: "voice.cancel", group: "voice", label: "Cancel the recording", key: "Esc"},

    // Help — KeyboardShortcutsSheet.tsx
    {id: "help.sheet", group: "help", label: "Keyboard shortcuts", key: "?"},

    // Inline rename — SessionTabLabel.tsx
    {id: "rename.commit", group: "rename", label: "Save the name", key: "↵"},
    {id: "rename.cancel", group: "rename", label: "Cancel the rename", key: "Esc"},
]

const BY_ID = new Map(PLAYGROUND_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]))

/** Look one up by id. Returns undefined rather than throwing, so a hint degrades to no hint. */
export const getShortcut = (id: string): Shortcut | undefined => BY_ID.get(id)

/** The groups in display order, each with its shortcuts. */
export const shortcutGroups = (): {id: ShortcutGroupId; title: string; shortcuts: Shortcut[]}[] =>
    (Object.keys(SHORTCUT_GROUP_TITLES) as ShortcutGroupId[]).map((id) => ({
        id,
        title: SHORTCUT_GROUP_TITLES[id],
        shortcuts: PLAYGROUND_SHORTCUTS.filter((shortcut) => shortcut.group === id),
    }))

/**
 * The key faces to print, in order, for this platform. Pass `mac` explicitly from a mount effect;
 * during render on the server there is no platform to read and a guess mismatches on hydration.
 */
export const shortcutFaces = (
    chord: {modifiers?: ShortcutModifier[]; key: string},
    mac = isMacPlatform(),
): string[] => {
    const modifiers = (chord.modifiers ?? []).map((m) =>
        mac ? MODIFIER_FACE[m].mac : MODIFIER_FACE[m].other,
    )
    return chord.key ? [...modifiers, chord.key] : modifiers
}

/** A flat text label, for a tooltip title or an aria-keyshortcuts attribute. */
export const shortcutText = (
    chord: {modifiers?: ShortcutModifier[]; key: string},
    mac = isMacPlatform(),
): string => shortcutFaces(chord, mac).join(mac ? "" : "+")
