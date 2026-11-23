import {Alert, Badge, Button, EmptyState, Field, IconTile, Input, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowClockwiseIcon, CopyIcon, PlusIcon, RobotIcon, TrashIcon} from "@phosphor-icons/react"

import type {GuideRule} from "../types"

export const buttonRules: GuideRule[] = [
    {
        id: "ACT-01",
        title: "One primary action per view",
        why: "The default (primary) button answers one question: what do I do here? Two of them give two answers.",
        do: {
            example: (
                <div className="flex gap-1">
                    <Button variant="ghost">Cancel</Button>
                    <Button variant="secondary">Save draft</Button>
                    <Button>Publish agent</Button>
                </div>
            ),
            caption: "One default button; the rest are quiet.",
        },
        avoid: {
            example: (
                <div className="flex gap-1">
                    <Button variant="outline">Cancel</Button>
                    <Button>Save draft</Button>
                    <Button>Publish agent</Button>
                </div>
            ),
            caption: "Two primary buttons. Which one?",
        },
        checkedBy: ["review"],
    },
    {
        id: "ACT-02",
        title: "Label a button with the action",
        why: "A verb and an object say what happens. OK and Submit make the user read the dialog again.",
        do: {
            example: (
                <div className="flex gap-1">
                    <Button variant="ghost">Keep agent</Button>
                    <Button variant="destructive">Delete agent</Button>
                </div>
            ),
            caption: "A dialog footer: Keep agent, Delete agent.",
        },
        avoid: {
            example: (
                <div className="flex gap-1">
                    <Button variant="ghost">Cancel</Button>
                    <Button>OK</Button>
                </div>
            ),
            caption: "OK to what?",
        },
        checkedBy: ["review"],
    },
    {
        id: "ACT-03",
        title: "Destructive actions are quiet until the final confirm",
        why: "A solid red button on a page is louder than the primary action. Solid red is only for the final confirm in a dialog.",
        do: {
            example: (
                <Button variant="destructive-ghost">
                    <TrashIcon /> Delete agent
                </Button>
            ),
            caption: "destructive-ghost on pages, toolbars and menus.",
        },
        avoid: {
            example: (
                <div className="flex gap-1">
                    <Button variant="outline">Edit</Button>
                    <Button variant="destructive">
                        <TrashIcon /> Delete agent
                    </Button>
                </div>
            ),
            caption: "Solid red on a page, next to a routine action.",
        },
        checkedBy: ["review"],
    },
    {
        id: "SIZE-01",
        title: "Pass a size, never a height",
        why: "A control owns its height, padding, radius, text and icon size, so size=\"sm\" is the same on every screen. A height class breaks that.",
        do: {
            example: (
                <div className="flex items-center gap-1">
                    <Input placeholder="Search" className="w-36" />
                    <Button variant="outline">Filter</Button>
                    <Button>New</Button>
                </div>
            ),
            caption: "One row, one height.",
        },
        avoid: {
            example: (
                <div className="flex items-center gap-1">
                    <Input placeholder="Search" className="w-36" style={{height: 36}} />
                    <Button variant="outline" style={{height: 30}}>Filter</Button>
                    <Button style={{height: 34}}>New</Button>
                </div>
            ),
            caption: "36, 30 and 34px: tops and bottoms do not line up.",
        },
        checkedBy: ["ratchet"],
    },
    {
        id: "SIZE-02",
        title: "Grouped buttons sit 4px apart, 8px at most",
        why: "A group reads as one unit only when its gap is smaller than the space around it. Use gap-1, and never more than gap-2.",
        do: {
            example: (
                <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label="Copy"><CopyIcon /></Button>
                    <Button variant="ghost" size="icon" aria-label="Retry"><ArrowClockwiseIcon /></Button>
                    <Button variant="ghost" size="icon" aria-label="Delete"><TrashIcon /></Button>
                </div>
            ),
            caption: "gap-1: one toolbar.",
        },
        avoid: {
            example: (
                <div className="flex" style={{gap: 20}}>
                    <Button variant="ghost" size="icon" aria-label="Copy"><CopyIcon /></Button>
                    <Button variant="ghost" size="icon" aria-label="Retry"><ArrowClockwiseIcon /></Button>
                    <Button variant="ghost" size="icon" aria-label="Delete"><TrashIcon /></Button>
                </div>
            ),
            caption: "Loose icons with no group.",
        },
        checkedBy: ["review"],
    },
]

export const formRules: GuideRule[] = [
    {
        id: "FORM-01",
        title: "Put field help in a ? tooltip",
        why: "Help text under every label doubles the height of the form. The label stays short; the help waits behind the ? icon.",
        do: {
            example: (
                <div className="w-60">
                    <Field label="Temperature" tooltip="Higher values give more varied answers.">
                        <Input defaultValue="0.7" />
                    </Field>
                </div>
            ),
            caption: "Short label, help on demand.",
        },
        avoid: {
            example: (
                <div className="w-60">
                    <Field label="Temperature" description="Higher values give more varied answers. Lower values give more predictable answers.">
                        <Input defaultValue="0.7" />
                    </Field>
                </div>
            ),
            caption: "Help text always visible, on every field.",
        },
        checkedBy: ["review"],
    },
    {
        id: "FORM-02",
        title: "One focus style",
        why: "Focus must look the same on every control, or users lose it. Use focus-ring on any control and focus-ring-field on a bordered field: an ink edge with a 2px lime ring. No gray halo, no gap.",
        do: {
            example: (
                <div className="w-56">
                    <div className="flex h-8 items-center rounded-md border border-foreground px-2.5 text-label" style={{outline: "2px solid var(--ring)"}}>
                        weekly-report
                    </div>
                </div>
            ),
            caption: "Ink border, 2px lime ring.",
        },
        avoid: {
            example: (
                <div className="w-56">
                    <div className="flex h-8 items-center rounded-lg px-2.5 text-label" style={{border: "1px solid #d9d92c", boxShadow: "0 0 0 4px rgba(163,161,159,.5)"}}>
                        weekly-report
                    </div>
                </div>
            ),
            caption: "Lime border plus a 4px gray halo.",
        },
        checkedBy: ["review"],
    },
]

export const badgeRules: GuideRule[] = [
    {
        id: "BADGE-01",
        title: "Five badge variants",
        why: "A badge color means a status. Neutral plus the four statuses cover every case; categorical colors (blue, purple, gold) add a second palette with no meaning. Data colors are for categories in charts and avatars, not badges. Badge text is text-caption.",
        do: {
            example: (
                <div className="flex flex-wrap gap-1">
                    <Badge>Draft</Badge>
                    <Badge variant="success">Passed</Badge>
                    <Badge variant="warning">Needs input</Badge>
                    <Badge variant="destructive">Failed</Badge>
                    <Badge variant="info">Running</Badge>
                </div>
            ),
            caption: "Neutral, and each status color on its own 10% tint.",
        },
        avoid: {
            example: (
                <div className="flex flex-wrap gap-1">
                    {["#e6f4ff:#1677ff", "#fff1f0:#cf1322", "#f9f0ff:#722ed1", "#fffbe6:#d48806", "#f0f5ff:#2f54eb"].map((pair) => {
                        const [bg, fg] = pair.split(":")
                        return (
                            <span key={pair} style={{background: bg, color: fg, border: `1px solid ${fg}55`, borderRadius: 4, padding: "0 7px", fontSize: 12}}>
                                tag
                            </span>
                        )
                    })}
                </div>
            ),
            caption: "Categorical colors with borders: decoration, not meaning.",
        },
        checkedBy: ["review"],
    },
]

export const markRules: GuideRule[] = [
    {
        id: "CONS-01",
        title: "A Mark's size comes from its place",
        why: "The same Mark has the same size wherever it appears: 16 inline, in nav and in menus · 20 in pickers and composer chips · 24 in list rows · 32 in page and dialog headers and cards · 40 in empty states. No 18, 22 or 28px Marks.",
        do: {
            example: (
                <div className="flex items-end gap-3">
                    {([16, 20, 24, 32, 40] as const).map((s) => (
                        <IconTile key={s} size={s}><RobotIcon /></IconTile>
                    ))}
                </div>
            ),
            caption: "Five sizes; the radius and the icon grow with them.",
        },
        avoid: {
            example: (
                <div className="flex items-end gap-3">
                    {[18, 22, 28, 36].map((s) => (
                        <span key={s} style={{width: s, height: s, borderRadius: s / 2.5, background: "var(--secondary)", display: "grid", placeItems: "center"}}>
                            <RobotIcon size={s * 0.6} />
                        </span>
                    ))}
                </div>
            ),
            caption: "One-off sizes with their own radii.",
        },
        checkedBy: ["review"],
    },
]

export const stateRules: GuideRule[] = [
    {
        id: "STATE-01",
        title: "An empty state says what to do next",
        why: "\"No data\" and \"Nothing here\" are dead ends. Say what is missing and why it matters, and offer the first action. Address the user as you.",
        do: {
            example: (
                <EmptyState title="No agents yet" description="Create an agent to automate a task you do every week.">
                    <Button>
                        <PlusIcon /> New agent
                    </Button>
                </EmptyState>
            ),
            caption: "What is missing, why, one action.",
        },
        avoid: {example: <span className="text-meta text-muted-foreground">No data</span>, caption: "A dead end."},
        checkedBy: ["review"],
    },
    {
        id: "STATE-02",
        title: "The skeleton matches the loaded view",
        why: "If the skeleton has another layout, the page jumps when the data arrives.",
        do: {
            example: (
                <div className="flex w-56 flex-col gap-3">
                    {[60, 45].map((w) => (
                        <div key={w} className="flex items-center gap-2">
                            <SkeletonBlock className="size-6 rounded-md" />
                            <div className="flex flex-1 flex-col gap-1.5">
                                <SkeletonBlock className="h-2.5" style={{width: `${w}%`}} />
                                <SkeletonBlock className="h-2" style={{width: `${w + 25}%`}} />
                            </div>
                        </div>
                    ))}
                </div>
            ),
            caption: "Mark, title and meta: the real row shape.",
        },
        avoid: {
            example: (
                <div className="flex w-56 flex-col gap-2">
                    <SkeletonBlock className="h-4" />
                    <SkeletonBlock className="h-4" />
                    <SkeletonBlock className="h-4 w-2/3" />
                </div>
            ),
            caption: "Generic bars: the layout shifts on load.",
        },
        checkedBy: ["review"],
    },
    {
        id: "STATE-03",
        title: "An error says what happened and how to fix it",
        why: "\"Something went wrong\" gives the user nothing to act on. Name the cause, what it means, and the next step.",
        do: {
            example: (
                <div className="w-64">
                    <Alert type="error" showIcon message="Slack is disconnected" description="The token expired. Reconnect to continue this run." />
                </div>
            ),
            caption: "Cause, effect, fix.",
        },
        avoid: {
            example: (
                <div className="w-64">
                    <Alert type="error" showIcon message="Something went wrong. Please try again." />
                </div>
            ),
            caption: "No cause, no fix.",
        },
        checkedBy: ["review"],
    },
]
