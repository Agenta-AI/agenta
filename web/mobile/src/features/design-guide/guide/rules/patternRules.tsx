import {Button, IconTile, Input} from "@agenta/ui/ui"
import {
    ArrowClockwiseIcon,
    CopyIcon,
    FunnelIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    SquaresFourIcon,
} from "@phosphor-icons/react"

import type {RuleExample} from "../types"

const line = "pointer-events-none absolute inset-y-0 border-l border-dashed border-destructive/60"

export const layoutRules: RuleExample[] = [
    {
        id: "ALIGN-01",
        do: {
            example: (
                <div className="relative w-64 pl-5 text-left">
                    <span className={line} style={{left: 20}} />
                    <div className="text-heading">Skills</div>
                    <div className="mb-2 text-meta text-muted-foreground">
                        Reusable instructions for agents
                    </div>
                    <div
                        className="mb-2 flex items-center gap-1.5 rounded-md border border-border py-1.5 pr-2 text-label text-muted-foreground"
                        style={{paddingLeft: 8}}
                    >
                        <MagnifyingGlassIcon /> Search skills
                    </div>
                    <div className="mb-1 text-meta text-muted-foreground">Name</div>
                    <div
                        className="flex items-center gap-2 rounded-md bg-accent py-1.5 pr-3 text-label"
                        style={{marginLeft: -12, paddingLeft: 12}}
                    >
                        <IconTile size={20}>S</IconTile> Slack Gif Creator
                    </div>
                </div>
            ),
            caption:
                "Title, description, the edge of the field, the label and the Mark on one line. Only the hover fill of the row hangs outside it.",
        },
        avoid: {
            example: (
                <div className="relative w-64 pl-5 text-left">
                    <span className={line} style={{left: 20}} />
                    <div className="text-heading">Skills</div>
                    <div className="mb-2 text-meta text-muted-foreground">
                        Reusable instructions for agents
                    </div>
                    <div
                        className="mb-2 flex items-center gap-1.5 rounded-md border border-border py-1.5 pr-2 text-label text-muted-foreground"
                        style={{marginLeft: -8, paddingLeft: 8}}
                    >
                        <MagnifyingGlassIcon /> Search skills
                    </div>
                    <div className="mb-1 text-meta text-muted-foreground" style={{paddingLeft: 12}}>
                        Name
                    </div>
                    <div
                        className="flex items-center gap-2 rounded-md bg-accent py-1.5 pr-3 text-label"
                        style={{paddingLeft: 12}}
                    >
                        <IconTile size={20}>S</IconTile> Slack Gif Creator
                    </div>
                </div>
            ),
            caption:
                "The field hangs outside the line, and the box of the row sits on it: the label and the Mark drift right.",
        },
    },
    {
        id: "LAYOUT-02",
        do: {
            example: (
                <div className="w-full rounded-md bg-background p-3">
                    <p className="mx-auto my-0 max-w-[24ch] text-body">
                        Agents run tasks for you on a schedule or on demand, with the tools you give
                        them.
                    </p>
                </div>
            ),
            caption: "A readable column, centered.",
        },
        avoid: {
            example: (
                <div className="w-full rounded-md bg-background p-3">
                    <p
                        className="m-0 text-body"
                        style={{whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip"}}
                    >
                        Agents run tasks for you on a schedule or on demand, with the tools you give
                        them.
                    </p>
                </div>
            ),
            caption: "One endless line across the window.",
        },
    },
]

export const touchRules: RuleExample[] = [
    {
        id: "SIZE-02",
        do: {
            example: (
                <div className="flex w-64 items-center gap-1 rounded-lg bg-background p-2 shadow-[inset_0_0_0_1px_var(--border-muted)]">
                    <Input size="sm" placeholder="Search" className="min-w-0 flex-1" />
                    <Button variant="ghost" size="icon-sm" aria-label="Filter">
                        <FunnelIcon />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Grid view">
                        <SquaresFourIcon />
                    </Button>
                    <Button size="icon-sm" aria-label="New agent">
                        <PlusIcon />
                    </Button>
                </div>
            ),
            caption: "A compact-window toolbar at 28px: everything fits one row.",
        },
        avoid: {
            example: (
                <div className="flex w-64 items-center gap-1 overflow-hidden rounded-lg bg-background p-2 shadow-[inset_0_0_0_1px_var(--border-muted)]">
                    <Input
                        placeholder="Search"
                        className="min-w-0 flex-1"
                        style={{height: 44, fontSize: 15}}
                    />
                    <Button variant="outline" aria-label="Filter" style={{width: 44, height: 44}}>
                        <FunnelIcon />
                    </Button>
                    <Button
                        variant="outline"
                        aria-label="Grid view"
                        style={{width: 44, height: 44}}
                    >
                        <SquaresFourIcon />
                    </Button>
                    <Button aria-label="New agent" style={{height: 44}}>
                        <PlusIcon /> New
                    </Button>
                </div>
            ),
            caption:
                "44px search, filter, view switcher and New: the toolbar is bulky and the search is squeezed.",
        },
    },
    {
        id: "TOUCH-01",
        do: {
            example: (
                <div className="w-56">
                    <div
                        className="flex h-9 items-center rounded-md border border-border px-2.5"
                        style={{fontSize: 16}}
                    >
                        <MagnifyingGlassIcon className="mr-1.5 text-muted-foreground" /> Ask
                        anything
                    </div>
                </div>
            ),
            caption: "16px on a touch screen: the page stays still.",
        },
        avoid: {
            example: (
                <div className="w-56 overflow-hidden">
                    <div
                        className="flex h-9 origin-left items-center rounded-md border border-border px-2.5"
                        style={{fontSize: 13, transform: "scale(1.3)"}}
                    >
                        <MagnifyingGlassIcon className="mr-1.5 text-muted-foreground" /> Ask
                        anything
                    </div>
                </div>
            ),
            caption: "13px on a touch screen: iOS zooms in and the layout breaks.",
        },
    },
    {
        id: "TOUCH-02",
        do: {
            example: (
                <div className="w-60 text-left">
                    <div className="rounded-lg bg-secondary px-3 py-2 text-body">
                        Here is the summary of this week.
                    </div>
                    <div className="mt-1 flex gap-1 text-muted-foreground">
                        <Button variant="ghost" size="icon-sm" aria-label="Copy">
                            <CopyIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Retry">
                            <ArrowClockwiseIcon />
                        </Button>
                    </div>
                </div>
            ),
            caption: "On touch the actions are always visible.",
        },
        avoid: {
            example: (
                <div className="w-60 text-left">
                    <div className="rounded-lg bg-secondary px-3 py-2 text-body">
                        Here is the summary of this week.
                    </div>
                    <div className="mt-1 flex gap-1" style={{opacity: 0.08}}>
                        <Button variant="ghost" size="icon-sm" aria-label="Copy" tabIndex={-1}>
                            <CopyIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Retry" tabIndex={-1}>
                            <ArrowClockwiseIcon />
                        </Button>
                    </div>
                </div>
            ),
            caption: "Hidden until hover: on a touch screen the actions never show.",
        },
    },
]
