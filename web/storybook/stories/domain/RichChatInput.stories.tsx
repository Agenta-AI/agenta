import {useEffect, useRef, useState} from "react"

import {
    PERMISSION_POLICY_OPTIONS,
    permissionPolicyLabel,
    type PermissionPolicy,
} from "@agenta/entity-ui/drill-in"
import PermissionsPickerPanel from "@agenta/oss/src/components/AgentChatSlice/components/SlashCommand/PermissionsPickerPanel"
import {
    HintKey,
    PalettePanel,
    RichChatInput,
    type PaletteItem,
    type PalettePanelProps,
    type PaletteSpec,
    type RichChatInputHandle,
    type SlashCommandSection,
} from "@agenta/ui/rich-chat-input"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {
    ChatCircleDots,
    CircleNotch,
    Cpu,
    FileText,
    FolderOpen,
    FolderSimple,
    GraduationCap,
    MagnifyingGlass,
    Paperclip,
    ShieldCheck,
} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * RichChatInput — a Lexical-based chat composer with markdown shortcuts, a send
 * button, shortcut hints, and prefix/header/footer slots. Rendered here with
 * MOCKED handlers; the last submitted message is echoed below.
 */
const meta = {
    title: "@agenta/ui/Domain/RichChatInput",
    component: RichChatInput,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A Lexical-based chat composer with markdown shortcuts, a send/stop button, shortcut hints, and prefix/header/footer slots. Rendered here off mocked handlers.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

/** Default composer. Type + press Enter (or the send button) to submit. */
export const Default: Story = {
    render: () => {
        const Demo = () => {
            const [last, setLast] = useState<string>("")
            return (
                <div className="w-[560px] flex flex-col gap-3">
                    <RichChatInput onSubmit={setLast} placeholder="Send a message…" />
                    {last && (
                        <div className="text-xs text-colorTextSecondary">
                            Last submitted: <code>{last}</code>
                        </div>
                    )}
                </div>
            )
        }
        return <Demo />
    },
}

/** With a leading prefix slot (e.g. an attach-files button). */
export const WithPrefix: Story = {
    render: () => (
        <div className="w-[560px]">
            <RichChatInput
                onSubmit={() => {}}
                placeholder="Ask anything…"
                prefix={
                    <button
                        type="button"
                        className="flex items-center justify-center rounded p-1 text-colorTextSecondary hover:bg-colorFillTertiary"
                        aria-label="Attach files"
                    >
                        <Paperclip size={16} />
                    </button>
                }
            />
        </div>
    ),
}

/** Streaming: the send button becomes a Stop button. */
export const Streaming: Story = {
    render: () => (
        <div className="w-[560px]">
            <RichChatInput
                onSubmit={() => {}}
                streaming
                onStop={() => {}}
                placeholder="Assistant is responding…"
            />
        </div>
    ),
}

/** Comfortable density (hero-scale surfaces). */
export const Comfortable: Story = {
    render: () => (
        <div className="w-[640px]">
            <RichChatInput
                onSubmit={() => {}}
                size="comfortable"
                placeholder="What would you like to build?"
            />
        </div>
    ),
}

/** Disabled state. */
export const Disabled: Story = {
    render: () => (
        <div className="w-[560px]">
            <RichChatInput onSubmit={() => {}} disabled placeholder="Composer disabled" />
        </div>
    ),
}

const SLASH_SECTIONS: SlashCommandSection[] = [
    {
        key: "commands",
        title: "Commands",
        items: [
            {
                key: "model",
                label: "/model",
                description: "Switch the model for this agent",
                tail: "DeepSeek V4 Flash ›",
                icon: <Cpu size={14} />,
                kind: "open" as const,
            },
            {
                key: "permissions",
                label: "/permissions",
                description: "Set what the agent may do before it must ask",
                tail: "Allow reads ›",
                icon: <ShieldCheck size={14} />,
                kind: "open" as const,
            },
            {
                key: "new",
                label: "/new",
                description: "Start a fresh session with this agent",
                icon: <ChatCircleDots size={14} />,
                // `action`, not `open`: it runs and is done, so the footer promises "run".
                kind: "action" as const,
            },
        ],
    },
    {
        key: "skills",
        title: "Skills",
        items: [
            {
                key: "diagnose",
                label: "/diagnose",
                description: "Disciplined diagnosis loop for hard bugs and regressions",
                icon: <GraduationCap size={14} />,
                kind: "insert" as const,
            },
            {
                key: "handoff",
                label: "/handoff",
                description: "Compact this conversation into a handoff document",
                icon: <GraduationCap size={14} />,
                kind: "insert" as const,
            },
        ],
    },
    // A Tools section sat here. `useChatSlashCommands` withholds one for now (its `SHOW_TOOLS`
    // flag), so the story mirrors what the composer actually offers.
]

const MODEL_GROUPS = [
    {
        label: "DeepSeek",
        options: [
            {label: "DeepSeek V4 Flash", value: "deepseek-v4-flash"},
            {label: "DeepSeek R2", value: "deepseek-r2"},
        ],
    },
    {
        label: "OpenAI",
        options: [
            {label: "GPT-5", value: "gpt-5"},
            {label: "GPT-4o", value: "gpt-4o"},
            {label: "GPT-4o mini", value: "gpt-4o-mini"},
        ],
    },
    {
        label: "Anthropic",
        options: [{label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6"}],
    },
]

/** The full `/` flow: palette, filtering, empty state, and the two pickers it drills into. */
export const SlashCommands: Story = {
    render: () => {
        const Demo = () => {
            const [last, setLast] = useState<string>("")
            const [picker, setPicker] = useState<"model" | "permissions" | null>(null)
            const [model, setModel] = useState("deepseek-v4-flash")
            const [permission, setPermission] = useState<PermissionPolicy>("allow_reads")
            const [applied, setApplied] = useState<string>("")
            const boxRef = useRef<HTMLDivElement | null>(null)
            const inputRef = useRef<RichChatInputHandle | null>(null)
            // Mirrors the dock: focus can only return AFTER the picker unmounts, and an outside
            // click is the one close that must not pull it back.
            const skipFocusRestore = useRef(false)
            const hadPicker = useRef(picker)
            useEffect(() => {
                const had = hadPicker.current
                hadPicker.current = picker
                if (!had || picker) return
                if (skipFocusRestore.current) {
                    skipFocusRestore.current = false
                    return
                }
                inputRef.current?.focus()
            }, [picker])
            const dismissPicker = (reason: "escape" | "outside") => {
                if (reason === "outside") skipFocusRestore.current = true
                setPicker(null)
            }
            // ...and clears it as the picker opens, a frame ahead of the picker so the editor's
            // reconcile cannot take focus back from it (which would dismiss it).
            // Mirrors the dock: "back to commands" restores the `/` the picker consumed.
            const backToCommands = () => {
                setPicker(null)
                inputRef.current?.insertText("/")
            }
            const openPicker = (which: "model" | "permissions") => {
                inputRef.current?.blur()
                requestAnimationFrame(() => setPicker(which))
            }

            const sections = SLASH_SECTIONS.map((section) => ({
                ...section,
                items: section.items.map((item) => ({
                    ...item,
                    tail:
                        item.key === "model"
                            ? `${model} ›`
                            : item.key === "permissions"
                              ? `${permissionPolicyLabel(permission)} ›`
                              : item.tail,
                    onSelect:
                        item.key === "model" || item.key === "permissions"
                            ? () => openPicker(item.key as "model" | "permissions")
                            : item.key === "new"
                              ? () => {
                                    // Mirrors the dock: the action runs, then the host clears the
                                    // command it consumed. No picker, so focus never leaves.
                                    setApplied("new session")
                                }
                              : undefined,
                })),
            }))

            const footer = (
                <div className="flex items-center gap-1.5 text-[10.5px] text-colorTextTertiary">
                    <span>Changes this agent&apos;s draft config.</span>
                    <span className="text-colorPrimary">Open config →</span>
                    <span
                        className="ml-auto flex cursor-pointer items-center gap-1.5"
                        onClick={backToCommands}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") backToCommands()
                        }}
                    >
                        <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[3px] bg-colorFillTertiary px-1 font-mono text-[9.5px] font-medium text-colorTextSecondary">
                            ←
                        </span>
                        back to commands
                    </span>
                </div>
            )

            return (
                <div className="flex w-[720px] flex-col gap-3 pt-[380px]">
                    <div className="relative" ref={boxRef}>
                        {picker === "permissions" ? (
                            <div className="absolute bottom-full left-0 right-0 z-[1050] mb-2 origin-bottom animate-command-panel-in motion-reduce:animate-command-panel-fade">
                                <PermissionsPickerPanel
                                    current={permission}
                                    options={PERMISSION_POLICY_OPTIONS}
                                    onApply={(next) => {
                                        setPermission(next)
                                        setApplied(`permissions → ${next}`)
                                        setPicker(null)
                                    }}
                                    onDismiss={dismissPicker}
                                    onBackToCommands={backToCommands}
                                    onOpenConfig={() => setApplied("open config")}
                                />
                            </div>
                        ) : null}
                        <SelectLLMProviderBase
                            open={picker === "model"}
                            onOpenChange={(next) => {
                                if (!next) setPicker(null)
                            }}
                            onDismissOutside={() => {
                                skipFocusRestore.current = true
                            }}
                            onStepBack={backToCommands}
                            anchorRef={boxRef}
                            hideTrigger
                            showGroup
                            showSearch
                            options={MODEL_GROUPS}
                            value={model}
                            onChange={(next) => {
                                setModel(next)
                                setApplied(`model → ${next}`)
                                setPicker(null)
                            }}
                            searchSuffix="/model"
                            panelFooter={footer}
                        />
                        <RichChatInput
                            ref={inputRef}
                            onSubmit={setLast}
                            placeholder="Ask the agent… (Enter to send, ⌘/Ctrl+Enter for newline)"
                            slashCommands={sections}
                        />
                    </div>
                    <div className="text-xs text-colorTextSecondary">
                        Submitted: <code>{last || "—"}</code> · Applied:{" "}
                        <code>{applied || "—"}</code>
                    </div>
                </div>
            )
        }
        return <Demo />
    },
}

const FILE_ROWS: {path: string; folder?: boolean; tail: string}[] = [
    {path: "agent-files", folder: true, tail: "12 items"},
    {path: "audits", folder: true, tail: "4 items"},
    {path: "AGENTS.md", tail: "2.3 KB · 3d ago"},
    {path: "README.md", tail: "293 B · 4d ago"},
]

const fileItem = (
    row: {path: string; folder?: boolean; tail: string},
    onDrillIn?: () => void,
): PaletteItem => ({
    key: row.path,
    label: row.folder ? `${row.path}/` : row.path,
    icon: row.folder ? <FolderSimple size={14} /> : <FileText size={14} />,
    tail: row.tail,
    kind: "insert",
    insertText: row.folder ? `${row.path}/` : row.path,
    insertAs: "code",
    onDrillIn: row.folder ? onDrillIn : undefined,
})

const filesHints = (activeItem: PaletteItem | undefined, inFolder?: string) => (
    <>
        <HintKey keys="↑↓" label="navigate" />
        <HintKey
            keys="↵"
            label={!activeItem ? "send" : activeItem.onDrillIn ? "reference folder" : "reference"}
        />
        {activeItem?.onDrillIn ? <HintKey keys="tab" label="open folder" /> : null}
        <HintKey keys="esc" label={inFolder ? "back" : "dismiss"} />
        {inFolder ? (
            <span className="ml-auto">
                searching inside <span className="font-mono">{inFolder}/</span>
            </span>
        ) : null}
    </>
)

const MOCK_DRIVE = [
    "AGENTS.md",
    "README.md",
    "audits/2026-08/slop-report.md",
    "audits/2026-08/findings.json",
    "agent-files/notes.md",
]

/** A live `@` palette over a fixed file list — type to filter, Tab to enter a folder, Esc to back out. */
const LiveFileMentions = () => {
    const [last, setLast] = useState("")
    const [query, setQuery] = useState<string | null>(null)
    const [cwd, setCwd] = useState("")

    const prefix = cwd ? `${cwd}/` : ""
    const rows = (() => {
        if (query) {
            return MOCK_DRIVE.filter((p) => p.startsWith(prefix) && p.includes(query)).map((p) => ({
                path: p,
                folder: false,
                tail: "4.8 KB",
            }))
        }
        const seen = new Map<string, boolean>()
        for (const p of MOCK_DRIVE) {
            if (!p.startsWith(prefix)) continue
            const rest = p.slice(prefix.length)
            const cut = rest.indexOf("/")
            seen.set(prefix + (cut < 0 ? rest : rest.slice(0, cut)), cut >= 0)
        }
        return [...seen].map(([path, folder]) => ({path, folder, tail: folder ? "open" : "4.8 KB"}))
    })()

    const spec: PaletteSpec = {
        key: "files",
        trigger: "@",
        allowSlashInQuery: true,
        label: "Files",
        filterMode: "none",
        onQueryChange: (next) => {
            setQuery(next)
            if (next === null) setCwd("")
        },
        onEscape: () => {
            if (!cwd) return false
            setCwd(cwd.includes("/") ? cwd.slice(0, cwd.lastIndexOf("/")) : "")
            return true
        },
        sections: rows.length
            ? [
                  {
                      key: "rows",
                      title: cwd || (query ? "Matches" : "Root"),
                      items: rows.map((row) => fileItem(row, () => setCwd(row.path))),
                  },
              ]
            : [],
        header: (
            <>
                <FolderOpen size={14} className="text-colorTextTertiary" />
                <span className="font-medium">Files</span>
                <span className="text-[11.5px] text-colorTextTertiary">
                    {cwd ? cwd : "this session's drive"}
                </span>
            </>
        ),
        footer: (activeItem) => filesHints(activeItem, cwd || undefined),
        emptyText: (q) => `No file or folder matches “${q}”`,
    }

    return (
        <div className="flex w-[560px] flex-col gap-3">
            <RichChatInput
                onSubmit={setLast}
                placeholder="Type @ to reference a file…"
                filePalette={spec}
            />
            <div className="text-xs text-colorTextSecondary">
                Submitted: <code>{last || "—"}</code>
            </div>
        </div>
    )
}

/** The `@` palette: a live composer, plus the states a reviewer cannot reach by typing. */
export const FileMentions: Story = {
    render: () => {
        const Board = () => {
            const [cwd, setCwd] = useState("")
            const rows = cwd ? FILE_ROWS.slice(2) : FILE_ROWS
            const panel = (
                title: string,
                props: Partial<PalettePanelProps> & {sections: PalettePanelProps["sections"]},
            ) => (
                <div className="flex w-[520px] flex-col gap-2">
                    <div className="text-[11px] uppercase tracking-wider text-colorTextTertiary">
                        {title}
                    </div>
                    <PalettePanel
                        listId={title}
                        label="Files"
                        query=""
                        activeIndex={0}
                        activeRowRef={{current: null}}
                        optionId={(i) => `${title}-${i}`}
                        onHover={() => {}}
                        onSelect={() => {}}
                        onDrillIn={() => {}}
                        floatingRef={() => {}}
                        floatingStyles={{position: "relative"}}
                        {...props}
                    />
                </div>
            )
            const items = rows.map((row) => fileItem(row, () => setCwd(row.path)))
            return (
                <div className="flex flex-col gap-10">
                    <LiveFileMentions />
                    <div className="flex flex-wrap gap-8">
                        {panel("Root", {
                            sections: [
                                {
                                    key: "recent",
                                    title: "Recently touched",
                                    items: items.slice(2, 3),
                                },
                                {key: "root", title: "Root", items},
                            ],
                            header: (
                                <>
                                    <FolderOpen size={14} className="text-colorTextTertiary" />
                                    <span className="font-medium">Files</span>
                                    <span className="text-[11.5px] text-colorTextTertiary">
                                        this session&apos;s drive
                                    </span>
                                </>
                            ),
                            footer: filesHints(items[0]),
                        })}
                        {panel("Search", {
                            query: "guide",
                            sections: [
                                {
                                    key: "hits",
                                    title: "",
                                    items: [
                                        fileItem({
                                            path: "agenta/docs/guide",
                                            folder: true,
                                            tail: "9 files",
                                        }),
                                        fileItem({
                                            path: "agenta/docs/guide/quickstart.mdx",
                                            tail: "4.8 KB",
                                        }),
                                    ],
                                },
                            ],
                            header: (
                                <>
                                    <MagnifyingGlass size={14} className="text-colorTextTertiary" />
                                    <span className="font-medium">Files</span>
                                    <span className="text-[11.5px] text-colorTextTertiary">
                                        across the drive
                                    </span>
                                </>
                            ),
                            footer: filesHints(undefined),
                        })}
                        {panel("Listing a folder", {
                            sections: [],
                            loading: true,
                            header: (
                                <>
                                    <FolderOpen size={14} className="text-colorTextTertiary" />
                                    <span className="font-mono text-xs">audits/2026-08</span>
                                    <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-colorTextTertiary">
                                        <CircleNotch size={11} className="animate-spin" />
                                        listing…
                                    </span>
                                </>
                            ),
                            footer: filesHints(undefined, "audits/2026-08"),
                        })}
                        {panel("No matches", {
                            query: "sitemap",
                            sections: [],
                            emptyText: (
                                <>
                                    No file or folder matches “sitemap”
                                    <div className="mt-[5px] text-[11px] text-colorTextTertiary">
                                        Enter sends the message as written.
                                    </div>
                                </>
                            ),
                            footer: filesHints(undefined),
                        })}
                    </div>
                </div>
            )
        }
        return <Board />
    },
}
