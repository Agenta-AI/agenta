import {
    Button,
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut,
    SimpleTooltip,
    Tabs,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {
    ArrowClockwiseIcon,
    ArrowUpIcon,
    CheckCircleIcon,
    CopyIcon,
    GearIcon,
    PaperclipIcon,
    PlusIcon,
    RobotIcon,
    TrashIcon,
} from "@phosphor-icons/react"

import {ScrollFadeDemo} from "../ScrollFadeDemo"
import type {GuideRule} from "../types"

const toastBox = "flex w-72 items-start gap-2 rounded-lg bg-popover p-3 text-left text-label shadow-overlay"
const th = "h-9 px-3 text-left text-meta text-muted-foreground"
const td = "h-9 px-3 text-label"
const RUNS = [
    {name: "Weekly report", status: "Passed", time: "2m ago", cost: "$0.04"},
    {name: "Triage inbox", status: "Failed", time: "1h ago", cost: "$0.11"},
]

export const tabsRules: GuideRule[] = [
    {
        id: "TABS-01",
        title: "Tabs switch views of one thing",
        why: "Tabs show sibling views of the same object, such as the runs and the settings of an agent. A tab never starts an action. Use the line variant on pages and the pill variant only inside a small panel. Labels are short nouns, with no icon in every tab.",
        do: {
            example: (
                <Tabs defaultValue="runs">
                    <TabsList>
                        <TabsTrigger value="runs">Runs</TabsTrigger>
                        <TabsTrigger value="settings">Settings</TabsTrigger>
                        <TabsTrigger value="access">Access</TabsTrigger>
                    </TabsList>
                </Tabs>
            ),
            caption: "Short nouns, line variant, one underline.",
            code: `<Tabs value={tab} onValueChange={setTab}>
  <TabsList>
    <TabsTrigger value="runs">Runs</TabsTrigger>
    <TabsTrigger value="settings">Settings</TabsTrigger>
  </TabsList>
  <TabsContent value="runs">…</TabsContent>
</Tabs>`,
        },
        avoid: {
            example: (
                <Tabs defaultValue="a">
                    <TabsList variant="pill">
                        <TabsTrigger value="a"><RobotIcon /> Agent Runs</TabsTrigger>
                        <TabsTrigger value="b"><GearIcon /> Agent Settings</TabsTrigger>
                        <TabsTrigger value="c">Create New</TabsTrigger>
                    </TabsList>
                </Tabs>
            ),
            caption: "Title Case, an icon in every tab, and an action as a tab.",
        },
        checkedBy: ["review"],
    },
]

export const tooltipRules: GuideRule[] = [
    {
        id: "TIP-01",
        title: "Every icon-only button has a tooltip",
        why: "An icon alone is a guess. The tooltip names the action in two or three words, with its shortcut when there is one. Touch users cannot hover, so the tooltip only repeats the aria-label; it never holds something the user needs.",
        do: {
            example: (
                <div className="flex gap-1">
                    <SimpleTooltip title="Copy" shortcut={["⌘", "C"]}>
                        <Button variant="ghost" size="icon" aria-label="Copy"><CopyIcon /></Button>
                    </SimpleTooltip>
                    <SimpleTooltip title="Retry">
                        <Button variant="ghost" size="icon" aria-label="Retry"><ArrowClockwiseIcon /></Button>
                    </SimpleTooltip>
                </div>
            ),
            caption: "Hover or focus: a short name and a shortcut.",
            code: `<SimpleTooltip title="Copy" shortcut={["⌘", "C"]}>
  <Button variant="ghost" size="icon" aria-label="Copy"><CopyIcon /></Button>
</SimpleTooltip>`,
        },
        avoid: {
            example: (
                <div className="flex gap-1">
                    <SimpleTooltip title="Click this button to copy the full contents of the message to your clipboard so you can paste it elsewhere.">
                        <Button variant="ghost" size="icon" aria-label="Copy"><CopyIcon /></Button>
                    </SimpleTooltip>
                    <Button variant="ghost" size="icon" aria-label="Retry"><ArrowClockwiseIcon /></Button>
                </div>
            ),
            caption: "A paragraph in one tooltip, none on the other.",
        },
        checkedBy: ["review"],
    },
]

export const toastRules: GuideRule[] = [
    {
        id: "TOAST-01",
        title: "A toast confirms; it does not ask",
        why: "A toast closes on its own, so it never holds a decision or an error the user must fix. An error that needs action stays inline, next to its cause.",
        do: {
            example: (
                <div className={toastBox}>
                    <CheckCircleIcon className="mt-0.5 text-success" />
                    <div className="flex-1">Connection removed</div>
                    <Button variant="ghost" size="xs">Undo</Button>
                </div>
            ),
            caption: "Past tense, with Undo.",
            code: `import {message} from "@agenta/ui/app-message"

message.success("Connection removed")`,
        },
        avoid: {
            example: (
                <div className={toastBox}>
                    <div className="flex-1">
                        Are you sure you want to remove this connection?
                        <div className="mt-2 flex gap-1">
                            <Button variant="ghost" size="xs">No</Button>
                            <Button variant="destructive" size="xs">Yes</Button>
                        </div>
                    </div>
                </div>
            ),
            caption: "A question that closes itself before the user answers.",
        },
        checkedBy: ["review"],
    },
]

export const tableRules: GuideRule[] = [
    {
        id: "TABLE-01",
        title: "Tables are rows, not a grid",
        why: "Grid lines and zebra fills add ink without adding meaning. Rows are 36px with a 1px border-muted divider between them. Numbers align right in tabular figures. On a phone the table becomes a list of rows.",
        do: {
            example: (
                <table className="w-72 border-collapse">
                    <thead>
                        <tr className="border-b border-border-muted">
                            <th className={th}>Run</th>
                            <th className={th}>Status</th>
                            <th className={`${th} text-right`}>Cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        {RUNS.map((r) => (
                            <tr key={r.name} className="border-b border-border-muted">
                                <td className={td}>{r.name}</td>
                                <td className={`${td} ${r.status === "Failed" ? "text-destructive" : "text-muted-foreground"}`}>{r.status}</td>
                                <td className={`${td} text-right tabular-nums`}>{r.cost}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ),
            caption: "Quiet header, row dividers, numbers on the right.",
            code: `<tr className="border-b border-border-muted">
  <td className="h-9 px-3 text-label">Weekly report</td>
  <td className="h-9 px-3 text-right tabular-nums">$0.04</td>
</tr>`,
        },
        avoid: {
            example: (
                <table className="w-72" style={{borderCollapse: "collapse"}}>
                    <thead>
                        <tr style={{background: "#242424", color: "#fff"}}>
                            {["RUN", "STATUS", "COST"].map((h) => (
                                <th key={h} style={{border: "1px solid #999", padding: 6, fontSize: 11, textAlign: "left"}}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {RUNS.map((r, i) => (
                            <tr key={r.name} style={{background: i % 2 ? "rgba(0,0,0,0.06)" : undefined}}>
                                <td style={{border: "1px solid #999", padding: 6}}>{r.name}</td>
                                <td style={{border: "1px solid #999", padding: 6}}>{r.status}</td>
                                <td style={{border: "1px solid #999", padding: 6}}>{r.cost}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ),
            caption: "A dark header, a full grid and zebra rows.",
        },
        checkedBy: ["review"],
    },
]

export const codeRules: GuideRule[] = [
    {
        id: "CODE-01",
        title: "Code blocks are quiet and copyable",
        why: "Code is content, not decoration. A code block is a bordered box: a muted header with the label and one Copy button, then the code in text-code on background. No line numbers on short snippets, and never a dark block on a light page.",
        do: {
            example: (
                <div className="w-72 overflow-hidden rounded-lg border border-border bg-background text-left">
                    <div className="flex items-center justify-between border-b border-border bg-muted py-1 pr-1 pl-3 text-meta text-muted-foreground">
                        curl
                        <Button variant="ghost" size="icon-xs" aria-label="Copy"><CopyIcon /></Button>
                    </div>
                    <pre className="m-0 overflow-x-auto p-3 text-code">{`curl $AGENTA_URL/api/runs \\\n  -H "Authorization: ApiKey $KEY"`}</pre>
                </div>
            ),
            caption: "Bordered box, label and Copy in the header, mono text.",
            code: `import {CodeBlock} from "@agenta/settings-ui"

<CodeBlock label="curl" code={snippet} />`,
        },
        avoid: {
            example: (
                <div className="w-64 rounded-md p-3 text-left" style={{background: "#0b0b0b", color: "#7dd3fc"}}>
                    <pre className="m-0" style={{fontSize: 12}}>{`1  curl https://cloud.agenta.ai/api/runs \\\n2    -H "Authorization: ApiKey $KEY"`}</pre>
                </div>
            ),
            caption: "A black slab with line numbers and no copy.",
        },
        checkedBy: ["review"],
    },
]

export const commandRules: GuideRule[] = [
    {
        id: "CMD-01",
        title: "The command palette lists actions as verb + object",
        why: "⌘K opens one palette for the whole app. Each item reads as an action, sits in a group named after its object, and shows its shortcut on the right. Destructive actions stay out: one wrong Enter must not delete anything.",
        do: {
            example: (
                <Command className="w-72 rounded-lg shadow-overlay">
                    <CommandInput placeholder="Search or run a command" />
                    <CommandList>
                        <CommandEmpty>No commands match.</CommandEmpty>
                        <CommandGroup heading="Agents">
                            <CommandItem><PlusIcon /> New agent<CommandShortcut>⌘N</CommandShortcut></CommandItem>
                            <CommandItem><RobotIcon /> Open Weekly report</CommandItem>
                        </CommandGroup>
                        <CommandGroup heading="Settings">
                            <CommandItem><GearIcon /> Open settings<CommandShortcut>⌘,</CommandShortcut></CommandItem>
                        </CommandGroup>
                    </CommandList>
                </Command>
            ),
            caption: "Grouped by object, verb first, shortcuts on the right.",
            code: `<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder="Search or run a command" />
  <CommandList>
    <CommandGroup heading="Agents">
      <CommandItem onSelect={newAgent}>
        <PlusIcon /> New agent<CommandShortcut>⌘N</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>`,
        },
        avoid: {
            example: (
                <Command className="w-72 rounded-lg shadow-overlay">
                    <CommandInput placeholder="Type here..." />
                    <CommandList>
                        <CommandGroup>
                            <CommandItem>Agent</CommandItem>
                            <CommandItem>Settings Page</CommandItem>
                            <CommandItem><TrashIcon /> Delete All Data</CommandItem>
                        </CommandGroup>
                    </CommandList>
                </Command>
            ),
            caption: "Bare nouns, no groups, a destructive item in the list.",
        },
        checkedBy: ["review"],
    },
]

export const composerRules: GuideRule[] = [
    {
        id: "COMP-01",
        title: "The composer is one field with its actions inside",
        why: "One box reads as one control. Attach sits on the left and send on the right, both inside the border of the field. Send is the only filled button, and it is disabled while the field is empty. The field grows with the text, then scrolls.",
        do: {
            example: (
                <div className="w-72 rounded-xl bg-background p-2 text-left shadow-[inset_0_0_0_1px_var(--border)]">
                    <div className="min-h-10 px-1 text-body text-muted-foreground">Ask the agent anything</div>
                    <div className="flex items-center justify-between">
                        <Button variant="ghost" size="icon-sm" aria-label="Attach"><PaperclipIcon /></Button>
                        <Button size="icon-sm" aria-label="Send"><ArrowUpIcon /></Button>
                    </div>
                </div>
            ),
            caption: "One box; send is the one filled button.",
            code: `import {ChatComposer} from "@agenta/chat"

<ChatComposer onSubmit={send} attachments={attachments} />`,
        },
        avoid: {
            example: (
                <div className="flex w-72 items-center gap-1">
                    <Button variant="outline" size="icon" aria-label="Attach"><PaperclipIcon /></Button>
                    <div className="flex-1 rounded-md border border-border px-2 py-1.5 text-body text-muted-foreground">Message</div>
                    <button type="button" style={{background: "#2563eb", color: "#fff", border: 0, borderRadius: 999, padding: "6px 14px", fontWeight: 700}}>SEND</button>
                </div>
            ),
            caption: "Three loose controls and a loud pill button.",
        },
        checkedBy: ["review"],
    },
]

export const chatRules: GuideRule[] = [
    {
        id: "CHAT-01",
        title: "The user's message is a bubble; the agent's reply is not",
        why: "The user's message sits on the right, on bg-secondary. The agent's reply is plain text at full width, so long answers, code and tables read like a document. Actions sit under the reply.",
        do: {
            example: (
                <div className="flex w-72 flex-col gap-3 text-left">
                    <div className="self-end rounded-lg bg-secondary px-3 py-2 text-body">Summarize this week</div>
                    <div>
                        <div className="text-body">
                            Three agents ran 128 times. Two runs failed on the Slack connection.
                            <div className="mt-1 flex gap-1 text-muted-foreground">
                                <Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button>
                                <Button variant="ghost" size="icon-sm" aria-label="Retry"><ArrowClockwiseIcon /></Button>
                            </div>
                        </div>
                    </div>
                </div>
            ),
            caption: "A bubble for the user, plain text for the agent, no avatar.",
        },
        avoid: {
            example: (
                <div className="flex w-72 flex-col gap-3 text-left">
                    <div className="self-end px-3 py-2 text-body" style={{background: "#2563eb", color: "#fff", borderRadius: 18}}>Summarize this week</div>
                    <div className="self-start px-3 py-2 text-body" style={{background: "#e5e7eb", color: "#111", borderRadius: 18, maxWidth: "80%"}}>
                        Three agents ran 128 times. Two runs failed on the Slack connection.
                    </div>
                </div>
            ),
            caption: "Two round, colored bubbles: a texting app, not a workspace.",
        },
        checkedBy: ["review"],
    },
]

export const spacingRules: GuideRule[] = [
    {
        id: "SPACE-01",
        title: "Space from the 4px scale, with more space between groups than inside them",
        why: "Use gap-1, 2, 3, 4, 6 or 8 (4 to 32px). Items in a group sit closer together than the groups do, so the eye finds the groups without lines.",
        do: {
            example: (
                <div className="flex w-56 flex-col gap-6 text-left">
                    <div className="flex flex-col gap-1">
                        <div className="text-label">Name</div>
                        <div className="text-body text-muted-foreground">Weekly report</div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="text-label">Schedule</div>
                        <div className="text-body text-muted-foreground">Mondays at 9:00</div>
                    </div>
                </div>
            ),
            caption: "4px inside a group, 24px between groups.",
        },
        avoid: {
            example: (
                <div className="flex w-56 flex-col text-left" style={{gap: 11}}>
                    <div className="text-label">Name</div>
                    <div className="text-body text-muted-foreground">Weekly report</div>
                    <div className="text-label">Schedule</div>
                    <div className="text-body text-muted-foreground">Mondays at 9:00</div>
                </div>
            ),
            caption: "An even 11px everywhere: which label owns which value?",
        },
        checkedBy: ["review"],
    },
    {
        id: "SPACE-02",
        title: "Rows are 36 or 48px in lists, 32px in menus",
        why: "Rows of one height make a list easy to scan. A one-line list row is 36px (row-single); a title with a meta line is 48px (row-double). Menu rows are 32px (MENU_ITEM, see ROW-01). Do not invent a 40px or 52px row for one screen.",
        do: {
            example: (
                <div className="w-56 text-left">
                    {["Agents", "Automations", "Connections"].map((r) => (
                        <div key={r} className="flex h-9 items-center px-2 text-label">{r}</div>
                    ))}
                </div>
            ),
            caption: "36px rows (h-9), the same in every list.",
        },
        avoid: {
            example: (
                <div className="w-56 text-left">
                    {[30, 44, 38].map((h, i) => (
                        <div key={h} className="flex items-center px-2 text-label" style={{height: h}}>{["Agents", "Automations", "Connections"][i]}</div>
                    ))}
                </div>
            ),
            caption: "30, 44 and 38px rows in one list.",
        },
        checkedBy: ["review"],
    },
]

export const scrollRules: GuideRule[] = [
    {
        id: "SCROLL-01",
        title: "Fade only the edge that can scroll",
        why: "A fade says there is more this way. At the top of a list there is nothing above, so there is no top fade. useScrollFadeEdges sets the edges from the scroll position.",
        do: {
            example: <ScrollFadeDemo mode="edges" />,
            caption: "At the top only the bottom edge fades. Scroll down and the top edge fades too.",
            code: `const ref = useRef<HTMLDivElement>(null)
useScrollFadeEdges(ref)

<div ref={ref} className="ag-scroll-fade overflow-y-auto">…</div>`,
        },
        avoid: {example: <ScrollFadeDemo mode="always" />, caption: "Both edges always fade: the first row looks cut off."},
        checkedBy: ["review"],
    },
]
