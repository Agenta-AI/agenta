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

import type {GuideRule} from "../types"

const panel = "w-52 rounded-lg bg-popover p-1 text-left shadow-overlay"
const legacyRow = (height: number, padX: number, gap: number, fontSize: number) =>
    ({height, padding: `0 ${padX}px`, gap, fontSize, display: "flex", alignItems: "center"}) as const

export const rowRules: GuideRule[] = [
    {
        id: "ROW-01",
        title: "Every menu row is the same row",
        why: "A menu, a select and a combobox are the same thing to a user, so their rows match. Dropdown, context menu, select, combobox and command palette all render MENU_ITEM: 32px tall, 8px side padding, text-label, a 16px icon 8px from the text. List and table rows are 36px (SPACE-02).",
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
        checkedBy: ["review"],
    },
    {
        id: "MENU-02",
        title: "A search popover has one shape",
        why: "Users learn the layout once. Pickers, the combobox and the command palette share it: search on top, group headings, MENU_ITEM rows, then a divider and the create or connect action as one more row. The search icon, the row icons and the action icon sit on one vertical line.",
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
        checkedBy: ["review"],
    },
]

export const gapRules: GuideRule[] = [
    {
        id: "GAP-01",
        title: "Icon to text: 4, 6 or 8px, by place",
        why: "The gap follows the place of the icon, never the screen. 4px in badges and xs buttons. 6px in other controls (buttons, tabs, segmented controls, fields). 8px in rows (menus, lists, nav, table cells).",
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
        checkedBy: ["review"],
    },
    {
        id: "GAP-02",
        title: "Mark to text: 8px for small marks, 12px for large",
        why: "A bigger Mark needs more room. A Mark (IconTile) of 16, 20 or 24px sits 8px from its text. A Mark of 32 or 40px, usually next to two lines, sits 12px away. The same Mark size always gets the same gap.",
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
        checkedBy: ["review"],
    },
]

const hoverRow = "flex w-60 items-center gap-2 rounded-md px-2 py-1.5 text-left text-label"

export const hoverRules: GuideRule[] = [
    {
        id: "HOVER-01",
        title: "One hover fill, one step darker than the surface",
        why: "Every hoverable row, menu item and ghost control uses bg-accent. It is ink at 5% (6% in dark), not a fixed gray, so it is the same step darker on the page, in the sidebar and in a popover. Do not pick muted, foreground/10 or a gray for one screen.",
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
        checkedBy: ["ratchet", "review"],
    },
    {
        id: "HOVER-02",
        title: "Nothing inside a row has the row's hover color",
        why: "A Mark, a chip or a quiet button inside a hoverable row must stay visible when the row is hovered. Fills inside rows are translucent (secondary is ink at 4%), so they stack on the hover and stay one step darker.",
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
        checkedBy: ["review"],
    },
]
