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
import type {RuleExample} from "../types"

const toastBox = "flex w-72 items-start gap-2 rounded-lg bg-popover p-3 text-left text-label shadow-overlay"
const th = "h-9 px-3 text-left text-meta text-muted-foreground"
const td = "h-9 px-3 text-label"
const RUNS = [
    {name: "Weekly report", status: "Passed", time: "2m ago", cost: "$0.04"},
    {name: "Triage inbox", status: "Failed", time: "1h ago", cost: "$0.11"},
]

export const tabsRules: RuleExample[] = [
    {
        id: "KIT-02",
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
                    <TabsList variant="track">
                        <TabsTrigger value="a"><RobotIcon /> Agent Runs</TabsTrigger>
                        <TabsTrigger value="b"><GearIcon /> Agent Settings</TabsTrigger>
                        <TabsTrigger value="c">Create New</TabsTrigger>
                    </TabsList>
                </Tabs>
            ),
            caption: "Title Case, an icon in every tab, and an action as a tab.",
        },
    },
]

export const tooltipRules: RuleExample[] = [
    {
        id: "KIT-03",
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
    },
]

export const toastRules: RuleExample[] = [
    {
        id: "KIT-05",
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
    },
]

export const tableRules: RuleExample[] = [
    {
        id: "KIT-06",
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
    },
]

export const codeRules: RuleExample[] = [
    {
        id: "KIT-07",
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
    },
]

export const commandRules: RuleExample[] = [
    {
        id: "KIT-08",
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
    },
]

export const composerRules: RuleExample[] = [
    {
        id: "KIT-09",
        do: {
            example: (
                <div className="w-72 rounded-xl bg-background p-2 text-left shadow-[inset_0_0_0_1px_var(--border)]">
                    <div className="min-h-10 px-1 text-body">Summarize the runs of this week</div>
                    <div className="flex items-center justify-between">
                        <Button variant="ghost" size="icon-sm" aria-label="Attach"><PaperclipIcon /></Button>
                        <Button size="icon-sm" aria-label="Send"><ArrowUpIcon /></Button>
                    </div>
                </div>
            ),
            caption: "One box with a draft in it; Send is the one filled button.",
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
    },
]

export const chatRules: RuleExample[] = [
    {
        id: "KIT-11",
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
            caption: "A bubble for the user, plain text for the agent, no Mark.",
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
    },
]

export const spacingRules: RuleExample[] = [
    {
        id: "SPACE-01",
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
    },
    {
        id: "ROW-01",
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
    },
]

export const scrollRules: RuleExample[] = [
    {
        id: "LAYOUT-05",
        do: {
            example: <ScrollFadeDemo mode="edges" />,
            caption: "At the top only the bottom edge fades. Scroll down and the top edge fades too.",
            code: `const ref = useRef<HTMLDivElement>(null)
useScrollFadeEdges(ref)

<div ref={ref} className="ag-scroll-fade overflow-y-auto">…</div>`,
        },
        avoid: {example: <ScrollFadeDemo mode="always" />, caption: "Both edges always fade: the first row looks cut off."},
    },
]
