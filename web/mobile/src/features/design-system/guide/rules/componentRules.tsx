import {Alert, Badge, Button, EmptyState, Field, IconTile, Input, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowClockwiseIcon, CopyIcon, PlusIcon, RobotIcon, TrashIcon} from "@phosphor-icons/react"

import type {RuleExample} from "../types"

export const buttonRules: RuleExample[] = [
    {
        id: "ACT-01",
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
    },
    {
        id: "ACT-02",
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
    },
    {
        id: "ACT-03",
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
    },
    {
        id: "SIZE-01",
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
    },
    {
        id: "SPACE-02",
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
    },
]

export const formRules: RuleExample[] = [
    {
        id: "FORM-01",
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
    },
    {
        id: "FORM-02",
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
    },
]

export const badgeRules: RuleExample[] = [
    {
        id: "KIT-01",
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
    },
]

export const markRules: RuleExample[] = [
    {
        id: "CONS-01",
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
    },
]

export const stateRules: RuleExample[] = [
    {
        id: "STATE-01",
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
    },
    {
        id: "STATE-02",
        do: {
            example: (
                <div className="flex w-56 flex-col gap-3">
                    {[60, 45].map((w) => (
                        <div key={w} className="flex items-center gap-2">
                            <SkeletonBlock className="size-6 rounded-md" />
                            <div className="flex flex-1 flex-col gap-1.5">
                                <SkeletonBlock className="h-2.5 rounded-xs" style={{width: `${w}%`}} />
                                <SkeletonBlock className="h-2 rounded-xs" style={{width: `${w + 25}%`}} />
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
    },
    {
        id: "STATE-03",
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
    },
]
