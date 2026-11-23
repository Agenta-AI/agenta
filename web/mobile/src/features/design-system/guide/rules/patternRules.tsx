import {Button, IconTile, Input} from "@agenta/ui/ui"
import {ArrowClockwiseIcon, CopyIcon, FunnelIcon, MagnifyingGlassIcon, PlusIcon, SquaresFourIcon} from "@phosphor-icons/react"

import type {GuideRule} from "../types"

const line = "pointer-events-none absolute inset-y-0 border-l border-dashed border-destructive/60"

export const layoutRules: GuideRule[] = [
    {
        id: "ALIGN-01",
        title: "Content sits on the title's left edge; boxes outdent",
        why: "The line aligns content, not boxes. The title, the search icon and text, the column header text and the row Marks share one left edge. A padded box hangs outside the line by its own padding (row 12px, input 8px), so its fill and border reach left of the line while its content stays on it. The kit does not apply outdents yet; that is open work.",
        do: {
            example: (
                <div className="relative w-64 pl-5 text-left">
                    <span className={line} style={{left: 20}} />
                    <div className="text-heading">Skills</div>
                    <div className="mb-2 text-meta text-muted-foreground">Reusable instructions for agents</div>
                    <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border py-1.5 pr-2 text-label text-muted-foreground" style={{marginLeft: -8, paddingLeft: 8}}>
                        <MagnifyingGlassIcon /> Search skills
                    </div>
                    <div className="mb-1 text-meta text-muted-foreground">Name</div>
                    <div className="flex items-center gap-2 rounded-md bg-accent py-1.5 pr-3 text-label" style={{marginLeft: -12, paddingLeft: 12}}>
                        <IconTile size={20}>S</IconTile> Slack Gif Creator
                    </div>
                </div>
            ),
            caption: "Title, search icon, column header and Mark on one line; the input and the hovered row hang outside it.",
        },
        avoid: {
            example: (
                <div className="relative w-64 pl-5 text-left">
                    <span className={line} style={{left: 20}} />
                    <div className="text-heading">Skills</div>
                    <div className="mb-2 text-meta text-muted-foreground">Reusable instructions for agents</div>
                    <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border py-1.5 pr-2 text-label text-muted-foreground" style={{paddingLeft: 8}}>
                        <MagnifyingGlassIcon /> Search skills
                    </div>
                    <div className="mb-1 text-meta text-muted-foreground" style={{paddingLeft: 12}}>Name</div>
                    <div className="flex items-center gap-2 rounded-md bg-accent py-1.5 pr-3 text-label" style={{paddingLeft: 12}}>
                        <IconTile size={20}>S</IconTile> Slack Gif Creator
                    </div>
                </div>
            ),
            caption: "Box edges on the line: the icon, the header and the Mark drift right by each padding.",
        },
        checkedBy: ["review"],
    },
    {
        id: "LAYOUT-02",
        title: "Cap the content width",
        why: "Text stretched across a wide window is hard to read. Lists cap at content-lg, chat at content-md, forms at content-sm.",
        do: {
            example: (
                <div className="w-full rounded-md bg-background p-3">
                    <p className="mx-auto my-0 max-w-[24ch] text-body">Agents run tasks for you on a schedule or on demand, with the tools you give them.</p>
                </div>
            ),
            caption: "A readable column, centered.",
        },
        avoid: {
            example: (
                <div className="w-full rounded-md bg-background p-3">
                    <p className="m-0 text-body" style={{whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip"}}>
                        Agents run tasks for you on a schedule or on demand, with the tools you give them.
                    </p>
                </div>
            ),
            caption: "One endless line across the window.",
        },
        checkedBy: ["review"],
    },
]

/** SIZE-03 is an anti-pattern only: it lives on the Anti-patterns page, not in the rules. */
export const touchGrowthAntiPattern: GuideRule = {
        id: "SIZE-03",
        title: "Never make controls or rows bigger on small screens or touch",
        why: "Bigger controls and rows on a phone make every screen bulky: the toolbar no longer fits, lists show half as many rows and the sidebar feels like a different app. The kit already steps controls down below 640px. No screen, row or primitive adds its own phone or touch size, and nothing adds a hidden tap box.",
        do: {
            example: (
                <div className="flex w-64 items-center gap-1 rounded-lg bg-background p-2 shadow-[inset_0_0_0_1px_var(--border-muted)]">
                    <Input size="sm" placeholder="Search" className="min-w-0 flex-1" />
                    <Button variant="ghost" size="icon-sm" aria-label="Filter"><FunnelIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Grid view"><SquaresFourIcon /></Button>
                    <Button size="icon-sm" aria-label="New agent"><PlusIcon /></Button>
                </div>
            ),
            caption: "A phone toolbar at 28px: everything fits one row.",
        },
        avoid: {
            example: (
                <div className="flex w-64 items-center gap-1 overflow-hidden rounded-lg bg-background p-2 shadow-[inset_0_0_0_1px_var(--border-muted)]">
                    <Input placeholder="Search" className="min-w-0 flex-1" style={{height: 44, fontSize: 15}} />
                    <Button variant="outline" aria-label="Filter" style={{width: 44, height: 44}}><FunnelIcon /></Button>
                    <Button variant="outline" aria-label="Grid view" style={{width: 44, height: 44}}><SquaresFourIcon /></Button>
                    <Button aria-label="New agent" style={{height: 44}}><PlusIcon /> New</Button>
                </div>
            ),
            caption: "44px search, filter, view switcher and New: the toolbar is bulky and the search is squeezed.",
        },
        checkedBy: ["review"],
    }

export const touchRules: GuideRule[] = [
    {
        id: "TOUCH-02",
        title: "Fields show 16px text on touch, at the same height",
        why: "iOS zooms the page when a field under 16px gets focus. touch.css sets 16px text under pointer: coarse and keeps the field's height. With a mouse, fields stay 13px.",
        do: {
            example: (
                <div className="w-56">
                    <div className="flex h-9 items-center rounded-md border border-border px-2.5" style={{fontSize: 16}}>
                        <MagnifyingGlassIcon className="mr-1.5 text-muted-foreground" /> Ask anything
                    </div>
                </div>
            ),
            caption: "16px on a phone: the page stays still.",
        },
        avoid: {
            example: (
                <div className="w-56 overflow-hidden">
                    <div className="flex h-9 origin-left items-center rounded-md border border-border px-2.5" style={{fontSize: 13, transform: "scale(1.3)"}}>
                        <MagnifyingGlassIcon className="mr-1.5 text-muted-foreground" /> Ask anything
                    </div>
                </div>
            ),
            caption: "13px on a phone: iOS zooms in and the layout breaks.",
        },
        checkedBy: ["review"],
    },
    {
        id: "TOUCH-03",
        title: "No action only on hover",
        why: "Touch has no hover. An action that appears on hover also appears on focus, and is always visible under pointer: coarse (pointer-coarse:opacity-100).",
        do: {
            example: (
                <div className="w-60 text-left">
                    <div className="rounded-lg bg-secondary px-3 py-2 text-body">Here is the summary of this week.</div>
                    <div className="mt-1 flex gap-1 text-muted-foreground">
                        <Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Retry"><ArrowClockwiseIcon /></Button>
                    </div>
                </div>
            ),
            caption: "On touch the actions are always visible.",
        },
        avoid: {
            example: (
                <div className="w-60 text-left">
                    <div className="rounded-lg bg-secondary px-3 py-2 text-body">Here is the summary of this week.</div>
                    <div className="mt-1 flex gap-1" style={{opacity: 0.08}}>
                        <Button variant="ghost" size="icon-sm" aria-label="Copy" tabIndex={-1}><CopyIcon /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Retry" tabIndex={-1}><ArrowClockwiseIcon /></Button>
                    </div>
                </div>
            ),
            caption: "Hidden until hover: on a phone the actions never show.",
        },
        checkedBy: ["review"],
    },
]
