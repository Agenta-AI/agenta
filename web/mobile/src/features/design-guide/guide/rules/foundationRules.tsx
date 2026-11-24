import {Badge, Button, IconTile, Switch} from "@agenta/ui/ui"
import {CheckIcon, GearIcon, HouseIcon, MagnifyingGlassIcon, RobotIcon, XIcon} from "@phosphor-icons/react"

import type {RuleExample} from "../types"

const card = "w-full max-w-64 rounded-lg bg-background p-4 text-left shadow-[inset_0_0_0_1px_var(--border-muted)]"

export const colorRules: RuleExample[] = [
    {
        id: "COLOR-01",
        do: {
            example: (
                <div className={card}>
                    <div className="text-label text-foreground">Weekly report</div>
                    <div className="text-body text-muted-foreground">Summarizes Linear issues every Monday</div>
                </div>
            ),
            caption: "foreground and muted-foreground: two text levels, one hue.",
        },
        avoid: {
            example: (
                <div className={card}>
                    <div style={{color: "#242424", fontSize: 13, fontWeight: 500}}>Weekly report</div>
                    <div style={{color: "#676770", fontSize: 13}}>Summarizes Linear issues every Monday</div>
                    <div style={{color: "#6e7475", fontSize: 12}}>Edited 2h ago</div>
                </div>
            ),
            caption: "Three hand-picked grays; one leans violet, one teal. The page looks off and nobody can say why.",
        },
    },
    {
        id: "COLOR-02",
        do: {
            example: (
                <div className="flex gap-1">
                    <Button variant="outline">Import</Button>
                    <Button variant="brand">New agent</Button>
                </div>
            ),
            caption: "One yellow element: New agent on Home.",
        },
        avoid: {
            example: (
                <div className="flex flex-col items-start gap-2">
                    <span style={{background: "#f2f25c", padding: "2px 6px", borderRadius: 4, fontSize: 11}}>New</span>
                    <div className="flex gap-1">
                        <Button variant="brand">Import</Button>
                        <Button variant="brand">New agent</Button>
                    </div>
                </div>
            ),
            caption: "Three yellow elements compete; the eye has no first stop.",
        },
    },
    {
        id: "COLOR-03",
        do: {
            example: (
                <div className="flex gap-2">
                    <Badge variant="success" icon={<CheckIcon />}>
                        Passed
                    </Badge>
                    <Badge variant="destructive" icon={<XIcon />}>
                        Failed
                    </Badge>
                </div>
            ),
            caption: "A 10% tint, an icon and a word.",
        },
        avoid: {
            example: (
                <div className="flex gap-4">
                    <span style={{width: 8, height: 8, background: "#20a04e", display: "inline-block"}} />
                    <span style={{width: 8, height: 8, background: "#d5584f", display: "inline-block"}} />
                </div>
            ),
            caption: "Two dots. Without color vision they are the same.",
        },
    },
    {
        id: "COLOR-05",
        do: {
            example: (
                <div className="flex gap-2">
                    {["W", "I", "B"].map((l) => (
                        <IconTile key={l}>{l}</IconTile>
                    ))}
                </div>
            ),
            caption: "Neutral Marks; the letter tells them apart.",
        },
        avoid: {
            example: (
                <div className="flex gap-2">
                    {["#2a5885", "#c2410c", "#d61010"].map((c, i) => (
                        <span
                            key={c}
                            style={{
                                width: 24,
                                height: 24,
                                background: c,
                                color: "#fff",
                                display: "grid",
                                placeItems: "center",
                                fontSize: 11,
                                borderRadius: 999,
                            }}
                        >
                            {"WIB"[i]}
                        </span>
                    ))}
                </div>
            ),
            caption: "Round Marks in hand-picked colors: a new palette, and the red one looks like an error.",
        },
    },
]

export const typeRules: RuleExample[] = [
    {
        id: "TYPE-01",
        do: {
            example: (
                <div className={card}>
                    <div className="text-title">Run settings</div>
                    <div className="text-body text-muted-foreground">Choose the model and tools.</div>
                    <div className="text-meta text-muted-foreground">Saved automatically</div>
                </div>
            ),
            caption: "text-title, text-body, text-meta.",
        },
        avoid: {
            example: (
                <div className={card}>
                    <div style={{fontSize: 15, fontWeight: 600}}>Run settings</div>
                    <div style={{fontSize: 13.5}}>Choose the model and tools.</div>
                    <div style={{fontSize: 12.5}}>Saved automatically</div>
                </div>
            ),
            caption: "15, 13.5 and 12.5px: each almost a style.",
        },
    },
    {
        id: "TYPE-04",
        do: {
            example: (
                <div className={card}>
                    <div className="text-label">claude-sonnet-5-5</div>
                    <div className="text-meta text-muted-foreground">Anthropic · 200k context</div>
                </div>
            ),
            caption: "Weight 500 for the name, muted for the meta.",
        },
        avoid: {
            example: (
                <div className={card}>
                    <div style={{fontWeight: 800, fontSize: 17}}>claude-sonnet-5-5</div>
                    <div style={{fontWeight: 700, fontSize: 11}}>Anthropic · 200k context</div>
                </div>
            ),
            caption: "Weights 800 and 700: both lines shout.",
        },
    },
    {
        id: "TYPE-05",
        do: {
            example: (
                <div className="flex w-56 flex-col gap-3 text-left">
                    <div className="flex gap-4 border-b border-border-muted text-label">
                        <span className="border-b-2 border-foreground pb-1.5 text-foreground">Runs</span>
                        <span className="pb-1.5 text-muted-foreground">Settings</span>
                    </div>
                    <div className="flex flex-col text-label">
                        <span className="rounded-md bg-selected px-2 py-1.5 text-foreground">Weekly report</span>
                        <span className="px-2 py-1.5 text-muted-foreground">Inbox triage</span>
                    </div>
                </div>
            ),
            caption: "Active tab and selected row at 500; only color and the fill change.",
        },
        avoid: {
            example: (
                <div className="flex w-56 flex-col gap-3 text-left">
                    <div className="flex gap-4 border-b border-border-muted text-label">
                        <span className="border-b-2 border-foreground pb-1.5 text-foreground" style={{fontWeight: 600}}>Runs</span>
                        <span className="pb-1.5 text-muted-foreground">Settings</span>
                    </div>
                    <div className="flex flex-col text-label">
                        <span className="rounded-md bg-selected px-2 py-1.5 text-foreground" style={{fontWeight: 600}}>Weekly report</span>
                        <span className="px-2 py-1.5 text-muted-foreground">Inbox triage</span>
                    </div>
                </div>
            ),
            caption: "Active tab and selected row turn semibold: the labels widen and read as titles.",
        },
    },
    {
        id: "TYPE-03",
        do: {
            example: <div className="w-28 text-right text-body tabular-nums">1,204.50<br />98.00<br />11,111.11</div>,
            caption: "tabular-nums: digits stack.",
        },
        avoid: {
            example: (
                <div className="w-28 text-right text-body" style={{fontVariantNumeric: "proportional-nums"}}>
                    1,204.50<br />98.00<br />11,111.11
                </div>
            ),
            caption: "The 1s are narrow and the columns drift.",
        },
    },
]

export const shapeRules: RuleExample[] = [
    {
        id: "SHAPE-01",
        do: {
            example: (
                <div className="flex flex-col items-start gap-3">
                    <div className="flex items-center gap-2">
                        <IconTile>AC</IconTile>
                        <Button variant="outline">Share</Button>
                        <Badge>Draft</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-label">
                        <span aria-hidden className="size-1.5 rounded-round bg-success" />
                        Live
                        <Switch defaultChecked aria-label="Run on schedule" className="ml-2" />
                    </div>
                </div>
            ),
            caption: "Square controls, Marks and badges; a round status dot and a round switch.",
        },
        avoid: {
            example: (
                <div className="flex items-center gap-2">
                    <span style={{width: 24, height: 24, borderRadius: 999, background: "var(--secondary)", display: "grid", placeItems: "center", fontSize: 11}}>AC</span>
                    <button type="button" style={{borderRadius: 999, border: "1px solid var(--border)", padding: "4px 12px", background: "var(--background)"}}>Share</button>
                    <span style={{borderRadius: 999, background: "var(--secondary)", padding: "2px 8px", fontSize: 11}}>Draft</span>
                    <span aria-hidden className="ml-2 size-1.5 rounded-xs bg-success" />
                </div>
            ),
            caption: "A circle Mark, a pill button and a pill badge, next to a square status dot.",
        },
    },
    {
        id: "SHAPE-02",
        do: {
            example: (
                <div className="w-48 rounded-xl bg-secondary p-1">
                    <div className="h-16 rounded-lg bg-background" />
                </div>
            ),
            caption: "12px outside, 4px padding, 8px inside.",
        },
        avoid: {
            example: (
                <div className="w-48 rounded-xl bg-secondary p-1">
                    <div className="h-16 rounded-xl bg-background" />
                </div>
            ),
            caption: "12px inside 12px: the corners look thick.",
        },
    },
]

export const iconRules: RuleExample[] = [
    {
        id: "ICON-01",
        do: {
            example: (
                <div className="flex gap-4 text-muted-foreground">
                    <HouseIcon size={20} />
                    <MagnifyingGlassIcon size={20} />
                    <GearIcon size={20} />
                    <RobotIcon size={20} />
                </div>
            ),
            caption: "One stroke weight, one cap style.",
        },
        avoid: {
            example: (
                <div className="flex gap-4 text-muted-foreground">
                    <HouseIcon size={20} />
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="square">
                        <circle cx="11" cy="11" r="6.5" />
                        <path d="m20 20-4.2-4.2" />
                    </svg>
                    <GearIcon size={20} />
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="square">
                        <rect x="5" y="8" width="14" height="11" />
                        <path d="M12 4v4" />
                    </svg>
                </div>
            ),
            caption: "Two libraries mixed: two icons look bold, two look thin.",
        },
    },
    {
        id: "ICON-02",
        do: {example: <Button variant="outline"><MagnifyingGlassIcon /> Search</Button>, caption: "One leading icon."},
        avoid: {
            example: (
                <Button variant="outline">
                    <MagnifyingGlassIcon /> Search <GearIcon />
                </Button>
            ),
            caption: "Is it a menu or an action?",
        },
    },
    {
        id: "ICON-05",
        do: {
            example: (
                <div className="flex flex-col gap-2 text-label">
                    <span className="flex items-center gap-2"><RobotIcon /> Agents</span>
                    <span className="flex items-center gap-2"><RobotIcon /> New agent</span>
                </div>
            ),
            caption: "Agent is always Robot.",
        },
        avoid: {
            example: (
                <div className="flex flex-col gap-2 text-label">
                    <span className="flex items-center gap-2"><RobotIcon /> Agents</span>
                    <span className="flex items-center gap-2"><GearIcon /> New agent</span>
                </div>
            ),
            caption: "The same term, two icons.",
        },
    },
]

export const surfaceRules: RuleExample[] = [
    {
        id: "SURF-01",
        do: {
            example: (
                <div className="w-56 rounded-lg bg-background p-3 text-left">
                    <div className="mb-2 text-label">Tools</div>
                    <div className="rounded-md bg-muted px-3 py-2 text-body">Slack · Linear · GitHub</div>
                </div>
            ),
            caption: "A muted block holds the group.",
        },
        avoid: {
            example: (
                <div className="w-56 rounded-lg p-3 text-left" style={{border: "1px solid var(--border)"}}>
                    <div className="mb-2 pb-2 text-label" style={{borderBottom: "1px solid var(--border)"}}>Tools</div>
                    <div className="rounded-md px-3 py-2 text-body" style={{border: "1px solid var(--border)"}}>Slack · Linear · GitHub</div>
                </div>
            ),
            caption: "Three borders for two areas.",
        },
    },
    {
        id: "SURF-03",
        do: {
            example: (
                <div className="relative h-28 w-56">
                    <div className="rounded-lg bg-background px-3 py-2 text-body shadow-[inset_0_0_0_1px_var(--border-muted)]">Card on the page</div>
                    <div className="absolute bottom-0 right-0 w-36 rounded-lg bg-popover p-1 text-body shadow-overlay">
                        <div className="rounded-sm bg-accent px-2 py-1">Rename</div>
                        <div className="px-2 py-1">Delete</div>
                    </div>
                </div>
            ),
            caption: "Flat card, floating menu.",
        },
        avoid: {
            example: (
                <div className="flex w-56 flex-col gap-2">
                    {[1, 2].map((i) => (
                        <div key={i} className="rounded-lg bg-background px-3 py-2 text-body" style={{boxShadow: "0 6px 18px #9a9a9a"}}>
                            Card on the page
                        </div>
                    ))}
                </div>
            ),
            caption: "Every card floats, on an opaque gray shadow, so nothing does.",
        },
    },
]
