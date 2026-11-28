import {IconTile} from "@agenta/ui/composed"
import {Badge, Button, Input} from "@agenta/ui/ui"
import {
    ArrowLeftIcon,
    ChatsIcon,
    CopyIcon,
    GearIcon,
    HouseIcon,
    ListIcon,
    PlayIcon,
    RobotIcon,
    TrashIcon,
} from "@phosphor-icons/react"

import type {RuleExample} from "../types"

const card =
    "w-full max-w-64 rounded-lg bg-background p-3 text-left shadow-[inset_0_0_0_1px_var(--border-muted)]"
const frame =
    "flex w-52 flex-col overflow-hidden rounded-lg bg-background text-left shadow-[inset_0_0_0_1px_var(--border-muted)]"
const tip = "rounded-sm bg-foreground px-2 py-1 text-caption text-background shadow-overlay"

export const moreTypeExamples: RuleExample[] = [
    {
        id: "TYPE-02",
        do: {
            example: (
                <div className={card}>
                    <div className="text-label text-foreground">Weekly report</div>
                    <div className="text-meta text-muted-foreground">
                        Runs every Monday · 2 min ago
                    </div>
                </div>
            ),
            caption: "The name is weight 500 in foreground; the meta is muted.",
        },
        avoid: {
            example: (
                <div className={card}>
                    <div className="text-title">Weekly report</div>
                    <div className="text-meta text-muted-foreground">
                        Runs every Monday · 2 min ago
                    </div>
                </div>
            ),
            caption: "The name grows to 16px to look important, and the row gets taller.",
        },
    },
]

export const moreColorExamples: RuleExample[] = [
    {
        id: "COLOR-04",
        do: {
            example: (
                <div className="rounded-lg bg-popover px-3 py-2 text-label shadow-overlay">
                    bg-popover
                </div>
            ),
            caption: "One variable; its value changes with the theme.",
            code: `<div className="bg-popover" />`,
        },
        avoid: {
            example: (
                <div className="rounded-lg bg-background px-3 py-2 text-code-sm shadow-overlay">
                    .dark .menu {"{ background: #222 }"}
                </div>
            ),
            caption: "A component that picks its own dark color drifts from the theme.",
        },
    },
]

export const moreIconExamples: RuleExample[] = [
    {
        id: "ICON-03",
        do: {
            example: (
                <Button variant="outline" size="icon" aria-label="Run">
                    <PlayIcon className="translate-x-px" />
                </Button>
            ),
            caption: "The play triangle moves 1px right and looks centered.",
        },
        avoid: {
            example: (
                <Button variant="outline" size="icon" aria-label="Run">
                    <PlayIcon />
                </Button>
            ),
            caption: "Centered by its box, the triangle looks pushed left.",
        },
    },
    {
        id: "ICON-04",
        do: {
            example: (
                <span className="inline-flex items-center gap-2 text-label">
                    <ChatsIcon className="size-4 text-muted-foreground" /> Sessions
                </span>
            ),
            caption: "16px next to 13px text, as in every row.",
        },
        avoid: {
            example: (
                <span className="inline-flex items-center gap-2 text-label">
                    <ChatsIcon className="size-5 text-muted-foreground" /> Sessions
                </span>
            ),
            caption: "A 20px icon picked for one screen outweighs the word.",
        },
    },
]

export const moreSurfaceExamples: RuleExample[] = [
    {
        id: "SURF-02",
        do: {
            example: (
                <div className="w-56 rounded-lg bg-background shadow-[inset_0_0_0_1px_var(--border)]">
                    <div className="px-3 py-2 text-label">Model</div>
                    <div className="border-0 border-t border-solid border-border-muted px-3 py-2 text-label">
                        Tools
                    </div>
                </div>
            ),
            caption: "One border, one divider inside.",
        },
        avoid: {
            example: (
                <div className="flex w-56 flex-col">
                    <div className="rounded-t-lg border border-solid border-border px-3 py-2 text-label">
                        Model
                    </div>
                    <div className="rounded-b-lg border border-solid border-border px-3 py-2 text-label">
                        Tools
                    </div>
                </div>
            ),
            caption: "Two bordered boxes stacked: a 2px seam between them.",
        },
    },
    {
        id: "SURF-04",
        do: {
            example: (
                <div className={`${card} cursor-pointer transition-colors hover:bg-accent`}>
                    Hover me: the fill darkens one step
                </div>
            ),
            caption: "Hover the card: only the fill changes.",
        },
        avoid: {
            example: (
                <div
                    className={`${card} cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-modal`}
                >
                    Hover me: the card lifts
                </div>
            ),
            caption: "Hover the card: it lifts and casts a shadow, as if it moved.",
        },
    },
]

export const moreSpaceExamples: RuleExample[] = [
    {
        id: "SPACE-05",
        do: {
            example: (
                <span className="inline-flex items-center gap-3 text-muted-foreground">
                    <CopyIcon className="size-4" />
                    <PlayIcon className="size-4" />
                    <TrashIcon className="size-4" />
                </span>
            ),
            caption: "The same gap between the drawn edges of the icons.",
        },
        avoid: {
            example: (
                <span className="inline-flex items-center text-muted-foreground">
                    <CopyIcon className="size-4" />
                    <span className="w-1" />
                    <PlayIcon className="size-4" />
                    <span className="w-5" />
                    <TrashIcon className="size-4" />
                </span>
            ),
            caption: "Gaps taken from uneven boxes: the icons look unevenly spaced.",
        },
    },
]

export const moreFormExamples: RuleExample[] = [
    {
        id: "FORM-03",
        do: {
            example: (
                <div className={card}>
                    <div className="mb-2 text-label">Rename agent</div>
                    <Input
                        defaultValue="Weekly report"
                        className="border-ring shadow-[0_0_0_1px_var(--ring)]"
                    />
                </div>
            ),
            caption: "The dialog opens with the field focused; the user types at once.",
        },
        avoid: {
            example: (
                <div className={card}>
                    <div className="mb-2 text-label">Rename agent</div>
                    <Input defaultValue="Weekly report" />
                </div>
            ),
            caption: "The dialog opens; the user must click into the only field first.",
        },
    },
]

export const moreLayoutExamples: RuleExample[] = [
    {
        id: "ALIGN-02",
        do: {
            example: (
                <div className="flex w-48 flex-col gap-0.5 rounded-lg bg-muted p-2 text-label">
                    <div className="flex h-7 items-center gap-2">
                        <IconTile size={16} tone="brand">
                            A
                        </IconTile>
                        Acme
                    </div>
                    <div className="flex h-7 items-center gap-2">
                        <HouseIcon className="size-4 text-muted-foreground" />
                        Home
                    </div>
                    <div className="flex h-7 items-center text-meta text-muted-foreground">
                        Weekly report
                    </div>
                    <div className="flex h-7 items-center">Draft for Monday</div>
                </div>
            ),
            caption:
                "The Mark, the icons, the group label and the session share the icon line; the labels of icon rows share the text line.",
        },
        avoid: {
            example: (
                <div className="flex w-48 flex-col gap-0.5 rounded-lg bg-muted p-2 text-label">
                    <div className="flex h-7 items-center gap-2">
                        <IconTile size={20}>A</IconTile>
                        Acme
                    </div>
                    <div className="flex h-7 items-center gap-2.5 pl-1">
                        <HouseIcon className="size-4 text-muted-foreground" />
                        Home
                    </div>
                    <div className="flex h-7 items-center pl-3 text-meta text-muted-foreground">
                        Weekly report
                    </div>
                    <div className="flex h-7 items-center pl-5">Draft for Monday</div>
                </div>
            ),
            caption: "Every row starts on a line of its own: the rail reads as a staircase.",
        },
    },
    {
        id: "LAYOUT-01",
        do: {
            example: (
                <div className="h-28 w-48 overflow-y-auto rounded-lg bg-background p-2 text-label shadow-[inset_0_0_0_1px_var(--border-muted)]">
                    {Array.from({length: 8}, (_, i) => (
                        <div key={i} className="py-1">
                            Run {i + 1}
                        </div>
                    ))}
                </div>
            ),
            caption: "One scroll area: the wheel always scrolls the list.",
        },
        avoid: {
            example: (
                <div className="h-28 w-48 overflow-y-auto rounded-lg bg-background p-2 text-label shadow-[inset_0_0_0_1px_var(--border-muted)]">
                    <div className="py-1">Runs</div>
                    <div className="h-16 overflow-y-auto rounded-md bg-muted px-2">
                        {Array.from({length: 8}, (_, i) => (
                            <div key={i} className="py-1">
                                Run {i + 1}
                            </div>
                        ))}
                    </div>
                    <div className="py-1">Settings</div>
                    <div className="py-1">History</div>
                </div>
            ),
            caption: "A scroll area inside a scroll area: the wheel gets stuck in the inner one.",
        },
    },
    {
        id: "LAYOUT-03",
        do: {
            example: (
                <div className="flex gap-2">
                    {["Agents", "Skills"].map((t) => (
                        <div
                            key={t}
                            className="w-24 rounded-md bg-background p-2 shadow-[inset_0_0_0_1px_var(--border-muted)]"
                        >
                            <div className="h-4" />
                            <div className="text-label">{t}</div>
                        </div>
                    ))}
                </div>
            ),
            caption: "Two pages, the title at the same height.",
        },
        avoid: {
            example: (
                <div className="flex items-start gap-2">
                    <div className="w-24 rounded-md bg-background p-2 shadow-[inset_0_0_0_1px_var(--border-muted)]">
                        <div className="text-meta text-muted-foreground">Home / Agents</div>
                        <div className="text-label">Agents</div>
                    </div>
                    <div className="w-24 rounded-md bg-background p-2 shadow-[inset_0_0_0_1px_var(--border-muted)]">
                        <div className="h-8" />
                        <div className="text-label">Skills</div>
                    </div>
                </div>
            ),
            caption: "A breadcrumb on one page, a deeper top on another: the title jumps.",
        },
    },
    {
        id: "LAYOUT-04",
        do: {
            example: (
                <div className="flex h-24 w-64 overflow-hidden rounded-lg bg-background outline outline-1 outline-border">
                    <div className="flex-1 p-2 text-label">Content</div>
                    <div className="w-20 bg-muted p-2 text-meta text-muted-foreground">
                        Right pane
                    </div>
                </div>
            ),
            caption: "One right pane, from the layout, holding one thing.",
        },
        avoid: {
            example: (
                <div className="flex h-24 w-64 overflow-hidden rounded-lg bg-background outline outline-1 outline-border">
                    <div className="flex-1 p-2 text-label">Content</div>
                    <div className="w-16 border-0 border-l border-solid border-border p-2 text-meta text-muted-foreground">
                        Page panel
                    </div>
                    <div className="w-16 bg-muted p-2 text-meta text-muted-foreground">
                        Right pane
                    </div>
                </div>
            ),
            caption: "A page draws its own panel next to the right pane; the content is squeezed.",
        },
    },
]

export const moreCompactHeaderExamples: RuleExample[] = [
    {
        id: "COMPACT-03",
        do: {
            example: (
                <div className={frame}>
                    <div className="flex h-11 items-center gap-2 px-2 text-label">
                        <Button variant="ghost" size="icon-sm" aria-label="Back">
                            <ArrowLeftIcon />
                        </Button>
                        Weekly report
                    </div>
                </div>
            ),
            caption: "A detail page: Back alone.",
        },
        avoid: {
            example: (
                <div className={frame}>
                    <div className="flex h-11 items-center gap-1 px-2 text-label">
                        <Button variant="ghost" size="icon-sm" aria-label="Menu">
                            <ListIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Back">
                            <ArrowLeftIcon />
                        </Button>
                        Weekly report
                    </div>
                </div>
            ),
            caption: "The menu and Back together: which way does each go?",
        },
    },
]

export const moreCompactExamples: RuleExample[] = [
    {
        id: "COMPACT-04",
        do: {
            example: (
                <div className={`${frame} h-40 justify-end bg-overlay`}>
                    <div className="rounded-t-lg bg-popover p-1 shadow-modal">
                        {["Rename", "Duplicate"].map((t) => (
                            <div key={t} className="flex h-8 items-center px-2 text-label">
                                {t}
                            </div>
                        ))}
                    </div>
                </div>
            ),
            caption: "The kit menu docks to the bottom as a sheet.",
        },
        avoid: {
            example: (
                <div className={`${frame} h-40 items-end p-2`}>
                    <div className="w-32 rounded-lg bg-popover p-1 shadow-overlay">
                        {["Rename", "Duplicate"].map((t) => (
                            <div key={t} className="flex h-8 items-center px-2 text-label">
                                {t}
                            </div>
                        ))}
                    </div>
                </div>
            ),
            caption: "A desktop popover squeezed into a compact window.",
        },
    },
    {
        id: "COMPACT-05",
        do: {
            example: <code className="text-code-sm">h-dvh pb-[env(safe-area-inset-bottom)]</code>,
            caption: "The real viewport and the safe area: nothing hides under the browser bar.",
        },
        avoid: {
            example: <code className="text-code-sm">h-screen /* 100vh */</code>,
            caption:
                "100vh is taller than the visible area: the bottom bar hides under the browser bar.",
        },
    },
]

export const moreTooltipExamples: RuleExample[] = [
    {
        id: "KIT-04",
        do: {
            example: (
                <div className="relative mr-30 w-56">
                    <div className="mb-1 text-label">Schedule</div>
                    <Input placeholder="Every Monday" />
                    <div className={`${tip} absolute left-[calc(100%+8px)] top-0 w-28`}>
                        When the automation runs
                    </div>
                </div>
            ),
            caption: "The tooltip opens to the side; the field stays free.",
        },
        avoid: {
            example: (
                <div className="relative w-56">
                    <div className="mb-1 text-label">Schedule</div>
                    <Input placeholder="Every Monday" />
                    <div className={`${tip} absolute left-0 top-5`}>When the automation runs</div>
                </div>
            ),
            caption: "The tooltip covers the field the user clicks next.",
        },
    },
]

export const moreMarkExamples: RuleExample[] = [
    {
        id: "CONS-02",
        do: {
            example: (
                <div className="flex flex-col gap-2">
                    {["List", "Picker"].map((place) => (
                        <span key={place} className="inline-flex items-center gap-2 text-label">
                            <IconTile size={24}>
                                <RobotIcon />
                            </IconTile>{" "}
                            Weekly report
                            <Badge>{place}</Badge>
                        </span>
                    ))}
                </div>
            ),
            caption: "The agent has the same Mark and name in the list and in the picker.",
        },
        avoid: {
            example: (
                <div className="flex flex-col gap-2">
                    <span className="inline-flex items-center gap-2 text-label">
                        <IconTile size={24}>
                            <RobotIcon />
                        </IconTile>{" "}
                        Weekly report <Badge>List</Badge>
                    </span>
                    <span className="inline-flex items-center gap-2 text-label">
                        <IconTile size={24}>W</IconTile> weekly-report <Badge>Picker</Badge>
                    </span>
                </div>
            ),
            caption: "A robot in the list, a letter and a slug in the picker: two things?",
        },
    },
]

export const moreKitExamples: RuleExample[] = [
    {
        id: "CONS-03",
        do: {
            example: (
                <Button variant="outline">
                    <GearIcon /> Settings
                </Button>
            ),
            caption: "The kit Button: size, focus and hover come with it.",
            code: `import {Button} from "@agenta/ui/ui"`,
        },
        avoid: {
            example: (
                <div className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-solid border-border px-3 py-1.5 text-body">
                    <GearIcon /> Settings
                </div>
            ),
            caption:
                "A div styled as a button: no focus, its own size, and it drifts on the next kit change.",
        },
    },
]
