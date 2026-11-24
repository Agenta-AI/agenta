import {ColorSection} from "../ColorSection"
import {ContrastSection} from "../ContrastSection"
import {IconTermsSection} from "../IconTermsSection"
import {KitComponentsSection} from "../KitComponentsSection"
import {OverlaysRow} from "../OverlaysRow"
import {ScaleSection} from "../ScaleSection"
import {TypeSection} from "../TypeSection"

import {badgeRules, buttonRules, formRules, markRules, stateRules} from "./rules/componentRules"
import {colorRules, iconRules, shapeRules, surfaceRules, typeRules} from "./rules/foundationRules"
import {
    chatRules,
    codeRules,
    commandRules,
    composerRules,
    scrollRules,
    spacingRules,
    tableRules,
    tabsRules,
    toastRules,
    tooltipRules,
} from "./rules/compositeRules"
import {microRules} from "./rules/microRules"
import {
    moreColorExamples,
    moreCompactExamples,
    moreCompactHeaderExamples,
    moreFormExamples,
    moreIconExamples,
    moreKitExamples,
    moreLayoutExamples,
    moreMarkExamples,
    moreSpaceExamples,
    moreSurfaceExamples,
    moreTooltipExamples,
    moreTypeExamples,
} from "./rules/moreExamples"
import {paneRules} from "./rules/paneRules"
import {layoutRules, touchRules} from "./rules/patternRules"
import {gapRules, hoverRules, rowRules} from "./rules/rowRules"
import {contentRules, motionRules, quietRules} from "./rules/voiceRules"
import {resolveRule} from "./ruleIndex"
import type {GuidePage, RuleExample} from "./types"

type GuidePageInput = Omit<GuidePage, "rules"> & {rules: RuleExample[]}

export function guidePages(mode: "light" | "dark"): GuidePage[] {
    const pages: GuidePageInput[] = [
        {id: "overview", group: "Overview", title: "Overview", tagline: "How Agenta looks, the rules it follows, and why.", rules: []},
        {id: "anti-patterns", group: "Overview", title: "Anti-patterns", tagline: "Every Avoid example in one place. If a screen looks like one of these, open its rule to see the fix.", rules: []},
        {id: "quiet", group: "Foundations", title: "Quiet, not loud", tagline: "Agenta is a work tool. Nothing on a screen shouts.", rules: quietRules},
        {
            id: "colors",
            group: "Foundations",
            title: "Color",
            tagline: "Each UI color has one job. There are also data colors for charts and categories and media colors for images. Tints are a color at low opacity, never a new color.",
            specimen: (
                <>
                    <ColorSection />
                    <ContrastSection mode={mode} />
                </>
            ),
            rules: [...colorRules, ...moreColorExamples],
        },
        {id: "type", group: "Foundations", title: "Typography", tagline: "One font, one set of text styles, two text levels. Weight shows rank, never state.", specimen: <TypeSection />, rules: [...typeRules, ...moreTypeExamples]},
        {id: "size", group: "Foundations", title: "Space and size", tagline: "A 4px grid, control heights that step down on a compact window, and one gap for each place.", specimen: <ScaleSection />, rules: [...spacingRules, ...gapRules, ...moreSpaceExamples]},
        {id: "shape", group: "Foundations", title: "Shape", tagline: "One radius scale. Only things round by nature are round.", rules: shapeRules},
        {id: "icons", group: "Foundations", title: "Icons", tagline: "Phosphor only, one icon per product term.", specimen: <IconTermsSection />, rules: [...iconRules, ...moreIconExamples]},
        {id: "surfaces", group: "Foundations", title: "Surfaces", tagline: "Tone separates areas, one fill marks hover, and shadows are only for things that float.", rules: [...surfaceRules, ...moreSurfaceExamples, ...hoverRules]},
        {id: "motion", group: "Foundations", title: "Motion", tagline: "Short, calm, and only when something changed. No bounce.", rules: motionRules},
        {id: "micro", group: "Foundations", title: "Microinteractions", tagline: "The control answers in its own place, at once, with one small change: a caret turns, an icon swaps, a panel unfolds from its trigger.", rules: microRules},
        {id: "voice", group: "Foundations", title: "Content and voice", tagline: "Sentence case, the words users see, and past-tense confirmations.", rules: contentRules},
        {id: "kit", group: "Components", title: "All components", tagline: "The real @agenta/ui/ui components, as every screen renders them.", specimen: <KitComponentsSection />, rules: moreKitExamples},
        {id: "buttons", group: "Components", title: "Buttons", tagline: "One primary button per view; quiet variants for the rest.", rules: buttonRules},
        {id: "forms", group: "Components", title: "Fields and focus", tagline: "Short labels, help on demand, one focus style.", rules: [...formRules, ...moreFormExamples]},
        {id: "badges", group: "Components", title: "Badges", tagline: "Neutral and the statuses. No other colors.", rules: badgeRules},
        {
            id: "tabs",
            group: "Components",
            title: "Tabs",
            tagline: "Sibling views of one object.",
            api: [
                {prop: "TabsList variant", values: `"line" | "track"`, note: "line on pages; track only inside a small panel"},
                {prop: "Tabs value / onValueChange", values: "string", note: "controlled; mirror it in the URL"},
                {prop: "TabsTrigger value", values: "string"},
            ],
            code: `import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/ui/ui"`,
            rules: tabsRules,
        },
        {
            id: "tooltip",
            group: "Components",
            title: "Tooltip",
            tagline: "A name for an icon-only button, never the only place for information.",
            api: [
                {prop: "title", values: "ReactNode", note: "two or three words"},
                {prop: "shortcut", values: `string | string[]`, note: `e.g. ["⌘", "K"]`},
                {prop: "side", values: `"top" | "right" | "bottom" | "left"`},
            ],
            code: `import {SimpleTooltip} from "@agenta/ui/ui"`,
            rules: [...tooltipRules, ...moreTooltipExamples],
        },
        {
            id: "toast",
            group: "Components",
            title: "Toast",
            tagline: "A short confirmation that closes itself.",
            api: [
                {prop: "message.success(text)", values: "string", note: "past tense: what happened"},
                {prop: "message.error(text)", values: "string", note: "only when there is no inline place"},
            ],
            code: `import {message} from "@agenta/ui/app-message"`,
            rules: toastRules,
        },
        {
            id: "table",
            group: "Components",
            title: "Table",
            tagline: "Rows and dividers. A list on a compact window.",
            api: [
                {prop: "row", values: "h-row-single", note: "the same on every screen; divider inside the height"},
                {prop: "divider", values: "border-b border-border-muted"},
                {prop: "number cell", values: "text-right tabular-nums"},
            ],
            rules: tableRules,
        },
        {
            id: "code",
            group: "Components",
            title: "Code block",
            tagline: "A bordered box, monospaced, one Copy button.",
            api: [
                {prop: "label", values: "string", note: "file name or language"},
                {prop: "code", values: "string"},
                {prop: "wrap", values: "boolean", note: "wrap instead of side scroll"},
                {prop: "maxHeightClass", values: "Tailwind class"},
            ],
            code: `import {CodeBlock} from "@agenta/settings-ui"`,
            rules: codeRules,
        },
        {
            id: "command",
            group: "Components",
            title: "Command palette",
            tagline: "⌘K: every action, by name.",
            api: [
                {prop: "CommandGroup heading", values: "string", note: "the object: Agents, Settings"},
                {prop: "CommandItem onSelect", values: "() => void", note: "verb + object label"},
                {prop: "CommandShortcut", values: "children", note: "right-aligned keys"},
            ],
            code: `import {\n    CommandDialog,\n    CommandGroup,\n    CommandInput,\n    CommandItem,\n    CommandList,\n} from "@agenta/ui/ui"`,
            rules: commandRules,
        },
        {
            id: "composer",
            group: "Components",
            title: "Composer",
            tagline: "One field with its actions inside; send is the one filled button.",
            api: [
                {prop: "onSubmit", values: "(text) => void | boolean | Promise", note: "return false to keep the draft"},
                {prop: "attachments", values: "useComposerAttachments()"},
                {prop: "maxHeightClassName", values: "Tailwind class", note: "where it starts to scroll"},
            ],
            code: `import {ChatComposer} from "@agenta/chat"`,
            rules: composerRules,
        },
        {
            id: "chat",
            group: "Components",
            title: "Chat message",
            tagline: "The user's turn is a bubble; the agent's reply is a document.",
            rules: chatRules,
        },
        {id: "marks", group: "Components", title: "Marks", tagline: "The neutral Mark (IconTile): one size for each place.", rules: [...markRules, ...moreMarkExamples]},
        {
            id: "overlays",
            group: "Components",
            title: "Menus and dialogs", tagline: "One menu row everywhere. Popovers on medium and expanded windows, bottom sheets on a compact window.", specimen: <OverlaysRow />,
            api: [
                {prop: "row", values: "MENU_ITEM", note: "32px, 8px side padding, 16px icon, 8px icon gap; the same on every screen"},
                {prop: "inset row", values: "MENU_ITEM_INSET", note: "for a check or an indented label"},
            ],
            rules: rowRules,
        },
        {id: "states", group: "Patterns", title: "View states", tagline: "Every view has loaded, empty, loading and error states.", rules: stateRules},
        {id: "layout", group: "Patterns", title: "Layout and alignment", tagline: "One alignment line, a capped content width, and fades only where a pane scrolls.", rules: [...layoutRules, ...moreLayoutExamples, ...scrollRules]},
        {id: "touch", group: "Patterns", title: "Touch and compact windows", tagline: "Fields stay readable, actions stay reachable, sheets replace popovers. Nothing gets bigger on a compact window or on touch.", rules: [...touchRules, ...moreCompactExamples]},
        {id: "agent-pane", group: "Patterns", title: "Right pane and compact edges", tagline: "The agent chat next to the item it talks about, one Composer, one item on the bottom edge, one compact header.", rules: [...paneRules, ...moreCompactHeaderExamples]},
    ]
    return pages.map((p) => ({...p, rules: p.rules.map(resolveRule)}))
}
