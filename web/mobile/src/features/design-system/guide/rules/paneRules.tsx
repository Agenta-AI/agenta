import {Button} from "@agenta/ui/ui"
import {ArrowUpIcon, CaretLeftIcon, DotsThreeIcon, HouseIcon, PaperclipIcon, PlusIcon, RobotIcon, XIcon} from "@phosphor-icons/react"

import type {RuleExample} from "../types"

const compactFrame = "flex w-52 flex-col overflow-hidden rounded-lg bg-background text-left shadow-[inset_0_0_0_1px_var(--border-muted)]"
const body = "flex flex-1 flex-col gap-1.5 p-3"
const bar = "h-2 rounded-xs bg-secondary"

export const paneRules: RuleExample[] = [
    {
        id: "LAYOUT-06",
        do: {
            example: (
                <div className="flex w-72 overflow-hidden rounded-lg text-left shadow-[inset_0_0_0_1px_var(--border-muted)]">
                    <div className="flex flex-1 flex-col gap-1.5 bg-background p-3">
                        <div className="text-label">Weekly report</div>
                        <div className={bar} />
                        <div className={bar} style={{width: "70%"}} />
                    </div>
                    <div className="flex w-32 flex-col justify-between gap-2 bg-muted p-2">
                        <div className="text-meta text-muted-foreground">Ask about Weekly report</div>
                        <div className="flex items-center justify-between rounded-md bg-background px-1.5 py-1 shadow-[inset_0_0_0_1px_var(--border)]">
                            <span className="text-meta text-muted-foreground">Ask</span>
                            <Button size="icon-xs" aria-label="Send"><ArrowUpIcon /></Button>
                        </div>
                    </div>
                </div>
            ),
            caption: "A right pane that names the item, with the same Composer.",
        },
        avoid: {
            example: (
                <div className="flex w-56 flex-col overflow-hidden rounded-lg bg-popover text-left shadow-[inset_0_0_0_1px_var(--border)]">
                    <div className="flex items-center justify-between p-2">
                        <span className="text-label">Chat</span>
                        <XIcon className="text-muted-foreground" />
                    </div>
                    <div className="px-2 pb-2">
                        <div className="rounded-md border border-border px-2 py-1 text-body text-muted-foreground">Type a message</div>
                    </div>
                </div>
            ),
            caption: "A dialog over the item, titled Chat: the item is hidden and not named.",
        },
    },
    {
        id: "KIT-10",
        do: {
            example: (
                <div className="flex w-60 flex-col gap-2 text-left">
                    <div className="flex items-center justify-between rounded-lg bg-background py-1 pl-3 pr-1 shadow-[inset_0_0_0_1px_var(--border)]">
                        <span className="text-body text-muted-foreground">Ask the agent</span>
                        <Button size="icon-sm" aria-label="Send" disabled><ArrowUpIcon /></Button>
                    </div>
                    <div className="rounded-lg bg-background p-2 shadow-[inset_0_0_0_1px_var(--border)]">
                        <div className="min-h-8 px-1 text-body text-muted-foreground">Ask the agent</div>
                        <div className="flex items-center justify-between">
                            <Button variant="ghost" size="icon-sm" aria-label="Attach"><PaperclipIcon /></Button>
                            <Button size="icon-sm" aria-label="Send" disabled><ArrowUpIcon /></Button>
                        </div>
                    </div>
                </div>
            ),
            caption: "Collapsed and open: the same box, the same Send.",
        },
        avoid: {
            example: (
                <div className="flex w-60 flex-col gap-2 text-left">
                    <div className="text-body text-muted-foreground" style={{border: "1px solid var(--border)", borderRadius: 4, padding: "6px 10px"}}>
                        Ask the agent…
                    </div>
                    <div className="rounded-lg bg-background p-2 shadow-[inset_0_0_0_1px_var(--border)]">
                        <div className="min-h-8 px-1 text-body text-muted-foreground">Ask the agent</div>
                        <div className="flex items-center justify-between">
                            <Button variant="ghost" size="icon-sm" aria-label="Attach"><PaperclipIcon /></Button>
                            <Button size="icon-sm" aria-label="Send" disabled><ArrowUpIcon /></Button>
                        </div>
                    </div>
                </div>
            ),
            caption: "A plain input as the entry: another radius, no Send, then a different box opens.",
        },
    },
    {
        id: "COMPACT-01",
        do: {
            example: (
                <div className={compactFrame} style={{height: 176}}>
                    <div className={body}>
                        <div className="text-label">Agents</div>
                        <div className={bar} />
                        <div className={bar} />
                    </div>
                    <div className="flex justify-around border-t border-border-muted py-2 text-muted-foreground">
                        <HouseIcon /> <RobotIcon /> <DotsThreeIcon />
                    </div>
                </div>
            ),
            caption: "The nav bar owns the edge; New is in the header.",
        },
        avoid: {
            example: (
                <div className={compactFrame} style={{height: 176}}>
                    <div className={body}>
                        <div className="text-label">Agents</div>
                        <div className={bar} />
                    </div>
                    <div className="px-2 pb-1">
                        <Button className="w-full" size="sm"><PlusIcon /> New agent</Button>
                    </div>
                    <div className="px-2 pb-1 text-body text-muted-foreground" style={{border: "1px solid var(--border)", margin: "0 8px 4px", borderRadius: 6}}>
                        Ask anything
                    </div>
                    <div className="flex justify-around border-t border-border-muted py-2 text-muted-foreground">
                        <HouseIcon /> <RobotIcon /> <DotsThreeIcon />
                    </div>
                </div>
            ),
            caption: "A button, a composer and the nav stacked on the edge.",
        },
    },
    {
        id: "COMPACT-02",
        do: {
            example: (
                <div className={compactFrame}>
                    <div className="flex h-11 items-center gap-1 border-b border-border-muted px-1">
                        <Button variant="ghost" size="icon" aria-label="Back"><CaretLeftIcon /></Button>
                        <span className="flex-1 truncate text-label">Weekly report</span>
                        <Button variant="ghost" size="icon" aria-label="More"><DotsThreeIcon /></Button>
                    </div>
                    <div className={body}><div className={bar} /></div>
                </div>
            ),
            caption: "44px tall, compact icon buttons, Back with a 16px caret, one title.",
        },
        avoid: {
            example: (
                <div className={compactFrame}>
                    <div className="flex items-center gap-1 border-b border-border-muted px-1" style={{height: 64}}>
                        <Button variant="outline" aria-label="Back" style={{width: 44, height: 44}}><CaretLeftIcon size={20} /></Button>
                        <div className="flex flex-1 flex-col">
                            <span className="text-title">Agents</span>
                            <span className="text-label">Weekly report</span>
                        </div>
                        <Button variant="outline" aria-label="More" style={{width: 44, height: 44}}><DotsThreeIcon size={20} /></Button>
                    </div>
                    <div className={body}><div className={bar} /></div>
                </div>
            ),
            caption: "A 64px header, 44px bordered buttons and two titles.",
        },
    },
]
