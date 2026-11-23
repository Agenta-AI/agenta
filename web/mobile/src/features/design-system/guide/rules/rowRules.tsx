import {
    Badge,
    Button,
    Command,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    IconTile,
    MENU_ITEM,
} from "@agenta/ui/ui"
import {
    CheckIcon,
    CopyIcon,
    GithubLogoIcon,
    PencilSimpleIcon,
    PlusIcon,
    RobotIcon,
    SlackLogoIcon,
} from "@phosphor-icons/react"

import type {RuleExample} from "../types"

const panel = "w-52 rounded-lg bg-popover p-1 text-left shadow-overlay"
const legacyRow = (height: number, padX: number, gap: number, fontSize: number) =>
    ({height, padding: `0 ${padX}px`, gap, fontSize, display: "flex", alignItems: "center"}) as const

export const rowRules: RuleExample[] = [
    {
        id: "ROW-02",
        do: {
            example: (
                <div className="flex flex-wrap gap-3">
                    <div className={panel}>
                        <div className={MENU_ITEM}><PencilSimpleIcon /> Rename</div>
                        <div className={MENU_ITEM}><CopyIcon /> Duplicate</div>
                    </div>
                    <div className={panel}>
                        <div className={`${MENU_ITEM} justify-between`}>claude-sonnet-5-5 <CheckIcon /></div>
                        <div className={MENU_ITEM}>claude-opus-5-5</div>
                    </div>
                </div>
            ),
            caption: "A menu and a select: same height, padding, gap and text.",
            code: `import {MENU_ITEM} from "@agenta/ui/ui"

// Only for a custom list that is not one of the kit menus:
<div role="option" className={MENU_ITEM}><RobotIcon /> Weekly report</div>`,
        },
        avoid: {
            example: (
                <div className="flex flex-wrap gap-3">
                    <div className={panel}>
                        <div style={legacyRow(28, 6, 6, 14)}><PencilSimpleIcon /> Rename</div>
                        <div style={legacyRow(28, 6, 6, 14)}><CopyIcon /> Duplicate</div>
                    </div>
                    <div className={panel}>
                        <div style={{...legacyRow(28, 12, 8, 14), fontWeight: 600}}>claude-sonnet-5-5</div>
                        <div style={legacyRow(36, 12, 8, 13)}>claude-opus-5-5</div>
                    </div>
                </div>
            ),
            caption: "A 28px menu, 28 and 36px select rows, 6 and 12px padding, 14px text.",
        },
    },
    {
        id: "ROW-03",
        do: {
            example: (
                <Command className="w-64 rounded-lg shadow-overlay">
                    <CommandInput placeholder="Search connections" />
                    <CommandList>
                        <CommandGroup heading="Connected">
                            <CommandItem><SlackLogoIcon /> Slack · acme</CommandItem>
                            <CommandItem><GithubLogoIcon /> GitHub · agenta</CommandItem>
                        </CommandGroup>
                        <CommandSeparator />
                        <CommandGroup>
                            <CommandItem><PlusIcon /> Connect another account</CommandItem>
                        </CommandGroup>
                    </CommandList>
                </Command>
            ),
            caption: "Search, a group of rows, a divider, then the action as one more row.",
            code: `<Command>
  <CommandInput placeholder="Search connections" />
  <CommandList>
    <CommandGroup heading="Connected">…</CommandGroup>
    <CommandSeparator />
    <CommandGroup>
      <CommandItem onSelect={connect}><PlusIcon /> Connect another account</CommandItem>
    </CommandGroup>
  </CommandList>
</Command>`,
        },
        avoid: {
            example: (
                <div className="w-64 rounded-lg bg-popover p-3 text-left shadow-overlay">
                    <div className="mb-2 rounded-md border border-border px-3 py-2 text-body text-muted-foreground">Search...</div>
                    <div style={legacyRow(28, 4, 4, 14)}><SlackLogoIcon /> Slack · acme</div>
                    <div style={legacyRow(40, 16, 12, 14)}><GithubLogoIcon /> GitHub · agenta</div>
                    <Button className="mt-2 w-full"><PlusIcon /> Connect another account</Button>
                </div>
            ),
            caption: "A tall search, rows on different edges, a big button as the action.",
        },
    },
]

export const gapRules: RuleExample[] = [
    {
        id: "SPACE-03",
        do: {
            example: (
                <div className="flex flex-col items-start gap-3">
                    <Badge variant="success" icon={<CheckIcon />}>Passed</Badge>
                    <Button variant="outline"><PlusIcon /> New agent</Button>
                    <div className={`${MENU_ITEM} w-48`}><RobotIcon /> Weekly report</div>
                </div>
            ),
            caption: "Badge 4px, button 6px, row 8px.",
            code: `badge, xs button   gap-1    4px
other controls     gap-1.5  6px   (Button, Tabs, Input)
row                gap-2    8px   (MENU_ITEM, list rows)`,
        },
        avoid: {
            example: (
                <div className="flex flex-col items-start gap-3 text-label">
                    <span className="flex items-center" style={{gap: 1}}><CheckIcon /> Passed</span>
                    <Button variant="outline" style={{gap: 12}}><PlusIcon /> New agent</Button>
                    <div className="flex w-48 items-center px-2" style={{gap: 10, height: 32}}><RobotIcon /> Weekly report</div>
                </div>
            ),
            caption: "1, 12 and 10px: three gaps picked by hand.",
        },
    },
    {
        id: "SPACE-04",
        do: {
            example: (
                <div className="flex flex-col items-start gap-4 text-left">
                    <div className="flex items-center gap-2 text-label">
                        <IconTile size={20}><RobotIcon /></IconTile> Weekly report
                    </div>
                    <div className="flex items-center gap-3">
                        <IconTile size={32}><RobotIcon /></IconTile>
                        <div>
                            <div className="text-label">Weekly report</div>
                            <div className="text-meta text-muted-foreground">Runs every Monday</div>
                        </div>
                    </div>
                </div>
            ),
            caption: "20px Mark: 8px. 32px Mark: 12px.",
            code: `<div className="flex items-center gap-2"><IconTile size={20} />…</div>
<div className="flex items-center gap-3"><IconTile size={32} />…</div>`,
        },
        avoid: {
            example: (
                <div className="flex flex-col items-start gap-4 text-left">
                    <div className="flex items-center text-label" style={{gap: 3}}>
                        <IconTile size={20}><RobotIcon /></IconTile> Weekly report
                    </div>
                    <div className="flex items-center" style={{gap: 20}}>
                        <IconTile size={32}><RobotIcon /></IconTile>
                        <div>
                            <div className="text-label">Weekly report</div>
                            <div className="text-meta text-muted-foreground">Runs every Monday</div>
                        </div>
                    </div>
                </div>
            ),
            caption: "3px: the Mark touches the text. 20px: the text floats away.",
        },
    },
]

const hoverRow = "flex w-60 items-center gap-2 rounded-md px-2 py-1.5 text-left text-label"

export const hoverRules: RuleExample[] = [
    {
        id: "SURF-05",
        do: {
            example: (
                <div className="flex flex-col gap-2">
                    {["bg-background", "bg-muted", "bg-popover shadow-overlay"].map((surface) => (
                        <div key={surface} className={`rounded-lg p-1 ${surface}`}>
                            <div className={`${hoverRow} bg-accent`}><RobotIcon /> Weekly report</div>
                        </div>
                    ))}
                </div>
            ),
            caption: "Page, sidebar, popover: the same hover step on each.",
            code: `<div className="hover:bg-accent">…</div>

// A row that must stay opaque (sticky): keep the ground, layer the hover on top.
<div className="sticky bg-background hover:bg-[image:linear-gradient(var(--accent),var(--accent))]">…</div>`,
        },
        avoid: {
            example: (
                <div className="flex flex-col gap-2">
                    {["var(--muted)", "rgba(0,0,0,0.15)", "#e5e7eb"].map((fill) => (
                        <div key={fill} className="rounded-lg bg-background p-1">
                            <div className={hoverRow} style={{background: fill}}><RobotIcon /> Weekly report</div>
                        </div>
                    ))}
                </div>
            ),
            caption: "muted, black at 15% and a stock gray: three hovers.",
        },
    },
    {
        id: "SURF-06",
        do: {
            example: (
                <div className={`${hoverRow} bg-accent`}>
                    <IconTile size={24}><RobotIcon /></IconTile>
                    <div>
                        <div>Release notes writer</div>
                        <div className="text-meta font-normal text-muted-foreground">Drafts release notes</div>
                    </div>
                </div>
            ),
            caption: "Hovered: the Mark is still a step darker than the row.",
        },
        avoid: {
            example: (
                <div className={hoverRow} style={{background: "var(--muted)"}}>
                    <IconTile size={24} style={{background: "var(--muted)"}}><RobotIcon /></IconTile>
                    <div>
                        <div>Release notes writer</div>
                        <div className="text-meta font-normal text-muted-foreground">Drafts release notes</div>
                    </div>
                </div>
            ),
            caption: "Hovered: the fill of the Mark equals the hover, and the Mark disappears.",
        },
    },
]
