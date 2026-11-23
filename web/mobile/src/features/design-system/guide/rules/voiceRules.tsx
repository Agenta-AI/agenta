import {Badge, Button} from "@agenta/ui/ui"
import {CheckCircleIcon, CircleNotchIcon, LightningIcon, RobotIcon, WarningCircleIcon} from "@phosphor-icons/react"

import {MotionSwapDemo} from "../MotionSwapDemo"
import type {RuleExample} from "../types"

const card = "w-full max-w-64 rounded-lg bg-background p-4 text-left shadow-[inset_0_0_0_1px_var(--border-muted)]"

export const quietRules: RuleExample[] = [
    {
        id: "LOUD-01",
        do: {
            example: (
                <div className={card}>
                    <div className="text-title">Upgrade to Pro</div>
                    <div className="mb-3 text-body text-muted-foreground">More runs and longer history.</div>
                    <Button>Upgrade plan</Button>
                </div>
            ),
            caption: "A neutral card; the one button carries the color.",
        },
        avoid: {
            example: (
                <div className="w-full max-w-64 rounded-lg p-4 text-left" style={{background: "linear-gradient(135deg,#7c3aed,#2563eb)", color: "#fff"}}>
                    <div className="text-title">Upgrade to Pro</div>
                    <div className="mb-3 text-body" style={{opacity: 0.85}}>More runs and longer history.</div>
                    <button type="button" style={{background: "#facc15", color: "#000", border: 0, borderRadius: 6, padding: "4px 12px"}}>Upgrade plan</button>
                </div>
            ),
            caption: "A purple-to-blue gradient and a yellow button: an ad, not a tool.",
        },
    },
    {
        id: "LOUD-02",
        do: {
            example: (
                <div className={card}>
                    <div className="text-meta text-muted-foreground">Credits left</div>
                    <div className="text-heading tabular-nums">12,480</div>
                </div>
            ),
            caption: "A metric in text-heading with a muted label.",
        },
        avoid: {
            example: (
                <div className={card}>
                    <div style={{fontSize: 11, fontWeight: 700}}>CREDITS LEFT</div>
                    <div style={{fontSize: 40, fontWeight: 800, letterSpacing: "-0.04em"}}>12,480</div>
                </div>
            ),
            caption: "A 40px number and an all-caps label shout over the page.",
        },
    },
    {
        id: "LOUD-03",
        do: {example: <div className="text-label">Agent published</div>, caption: "Sentence case, calm."},
        avoid: {example: <div style={{fontSize: 13, fontWeight: 700, letterSpacing: "0.06em"}}>🎉 AGENT PUBLISHED!</div>, caption: "Caps, emoji and an exclamation mark."},
    },
    {
        id: "LOUD-04",
        do: {
            example: (
                <div className="flex flex-col gap-2 text-label text-muted-foreground">
                    <span className="flex items-center gap-2"><RobotIcon /> Agents</span>
                    <span className="flex items-center gap-2"><LightningIcon /> Automations</span>
                    <span className="flex items-center gap-2 text-success"><CheckCircleIcon /> Passed</span>
                </div>
            ),
            caption: "Nav icons in the text color; only the status icon is green.",
        },
        avoid: {
            example: (
                <div className="flex flex-col gap-2 text-label">
                    <span className="flex items-center gap-2"><RobotIcon color="#7c3aed" /> Agents</span>
                    <span className="flex items-center gap-2"><LightningIcon color="#f59e0b" /> Automations</span>
                    <span className="flex items-center gap-2"><CheckCircleIcon color="#10b981" /> Passed</span>
                </div>
            ),
            caption: "A color per icon: the status no longer stands out.",
        },
    },
    {
        id: "LOUD-05",
        do: {
            example: (
                <div className="flex items-center gap-2">
                    <Badge>Draft</Badge>
                    <Badge variant="destructive" icon={<WarningCircleIcon />}>2 errors</Badge>
                    <Button variant="outline">Review</Button>
                </div>
            ),
            caption: "Neutral around one red status.",
        },
        avoid: {
            example: (
                <div className="flex items-center gap-2">
                    <Badge variant="info">Draft</Badge>
                    <Badge variant="destructive">2 errors</Badge>
                    <Badge variant="success">Synced</Badge>
                    <Button variant="brand">Review</Button>
                </div>
            ),
            caption: "Blue, red, green and yellow together.",
        },
    },
    {
        id: "LOUD-06",
        do: {example: <div className={card}><div className="text-label">1px border-muted edge</div></div>, caption: "A 1px border-muted edge."},
        avoid: {
            example: (
                <div className="w-full max-w-64 rounded-lg bg-background p-4 text-left" style={{border: "2px solid #242424", boxShadow: "4px 4px 0 #242424"}}>
                    <div className="text-label">2px border, hard shadow</div>
                </div>
            ),
            caption: "A heavy frame: the card is louder than its content.",
        },
    },
]

export const contentRules: RuleExample[] = [
    {
        id: "COPY-01",
        do: {example: <div className="flex gap-1"><Button variant="outline">New agent</Button><Button variant="outline">Run history</Button></div>, caption: "New agent, Run history."},
        avoid: {example: <div className="flex gap-1"><Button variant="outline">New Agent</Button><Button variant="outline">Run History</Button></div>, caption: "New Agent, Run History."},
    },
    {
        id: "COPY-02",
        do: {
            example: (
                <div className="flex w-72 items-start gap-2 rounded-lg bg-popover p-3 text-label shadow-overlay">
                    <CheckCircleIcon className="mt-0.5 text-success" />
                    <div className="flex-1">Agent published<div className="font-normal text-muted-foreground">Weekly report is live.</div></div>
                    <Button variant="ghost" size="xs">Undo</Button>
                </div>
            ),
            caption: "Result first, detail second, one action.",
        },
        avoid: {
            example: (
                <div className="flex w-72 items-start gap-2 rounded-lg bg-popover p-3 text-label shadow-overlay">
                    <div className="flex-1">Success!<div className="font-normal text-muted-foreground">The operation completed successfully.</div></div>
                </div>
            ),
            caption: "Success! of what?",
        },
    },
    {
        id: "COPY-03",
        do: {example: <div className="text-label">3 connections · 128 runs</div>, caption: "Product words."},
        avoid: {example: <div className="text-label">3 integration configs · 128 invocations</div>, caption: "System words."},
    },
]

export const motionRules: RuleExample[] = [
    {
        id: "MOTION-01",
        do: {example: <MotionSwapDemo animated />, caption: "Click Next step: a fade and a 4px slide."},
        avoid: {example: <MotionSwapDemo animated={false} />, caption: "Click Next step: the text just changes. Did anything happen?"},
    },
    {
        id: "MOTION-02",
        do: {example: <Badge variant="info" icon={<CircleNotchIcon className="animate-spin" />}>Running</Badge>, caption: "A still badge; the spinner inside is the only motion."},
        avoid: {example: <span className="animate-bounce"><Badge variant="info">Running</Badge></span>, caption: "A bouncing badge pulls the eye for as long as the run lasts."},
    },
]
