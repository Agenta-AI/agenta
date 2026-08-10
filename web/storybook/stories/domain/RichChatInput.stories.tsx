import {useEffect, useRef, useState} from "react"

import {
    PERMISSION_POLICY_OPTIONS,
    permissionPolicyLabel,
    type PermissionPolicy,
} from "@agenta/entity-ui/drill-in"
import HarnessPickerPanel from "@agenta/oss/src/components/AgentChatSlice/components/SlashCommand/HarnessPickerPanel"
import PermissionsPickerPanel from "@agenta/oss/src/components/AgentChatSlice/components/SlashCommand/PermissionsPickerPanel"
import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {
    ChatCircleDots,
    Cpu,
    Cube,
    GraduationCap,
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

const SLASH_SECTIONS = [
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
                key: "harness",
                label: "/harness",
                description: "Switch the runtime that executes this agent",
                tail: "Pi ›",
                icon: <Cube size={14} />,
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

/** Mocked harness catalog — the same shape `/inspect` publishes as `harness_capabilities`. */
const MOCK_CAPABILITIES = {
    pi_core: {
        providers: ["openai", "anthropic", "gemini", "mistral", "deepseek"],
        deployments: ["direct", "custom"],
        connection_modes: ["agenta", "self_managed"],
        model_catalog: [
            {id: "deepseek-v4-flash", provider: "deepseek", label: "DeepSeek V4 Flash"},
            {id: "gpt-5", provider: "openai", label: "GPT-5"},
            {id: "gpt-4o", provider: "openai", label: "GPT-4o"},
            {id: "claude-sonnet-4-6", provider: "anthropic", label: "Claude Sonnet 4.6"},
        ],
    },
    claude: {
        providers: ["anthropic", "bedrock", "vertex"],
        deployments: ["direct", "custom"],
        connection_modes: ["agenta"],
        model_catalog: [
            {id: "claude-sonnet-4-6", provider: "anthropic", label: "Claude Sonnet 4.6"},
            {id: "claude-opus-4-1", provider: "anthropic", label: "Claude Opus 4.1"},
        ],
    },
    codex: {
        providers: ["openai", "openai_codex"],
        deployments: ["direct"],
        connection_modes: ["agenta"],
        model_catalog: [{id: "gpt-5", provider: "openai", label: "GPT-5"}],
    },
} as never

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

/**
 * The full `/` flow. Type `/` to open the palette, `/mo` to filter (the match highlights inside the
 * name), `/xyz` for the empty state — Enter there sends the text instead of selecting.
 * `/model` and `/harness` drill into the real pickers, anchored over the composer exactly as the
 * chat dock mounts them.
 */
export const SlashCommands: Story = {
    render: () => {
        const Demo = () => {
            const [last, setLast] = useState<string>("")
            const [picker, setPicker] = useState<"model" | "harness" | "permissions" | null>(null)
            const [model, setModel] = useState("deepseek-v4-flash")
            const [harness, setHarness] = useState("pi_core")
            const [permission, setPermission] = useState<PermissionPolicy>("allow_reads")
            const [applied, setApplied] = useState<string>("")
            const boxRef = useRef<HTMLDivElement | null>(null)
            const inputRef = useRef<RichChatInputHandle | null>(null)
            // The dock clears the typed command once a picker applies; mirror it so the story
            // behaves like the real composer.
            const clearCommand = () => {
                inputRef.current?.clear()
            }
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
                inputRef.current?.setMarkdown("/")
            }
            const openPicker = (which: "model" | "harness" | "permissions") => {
                inputRef.current?.blur()
                inputRef.current?.clear()
                requestAnimationFrame(() => setPicker(which))
            }

            const sections = SLASH_SECTIONS.map((section) => ({
                ...section,
                items: section.items.map((item) => ({
                    ...item,
                    tail:
                        item.key === "model"
                            ? `${model} ›`
                            : item.key === "harness"
                              ? `${harness} ›`
                              : item.key === "permissions"
                                ? `${permissionPolicyLabel(permission)} ›`
                                : item.tail,
                    onSelect:
                        item.key === "model" || item.key === "harness" || item.key === "permissions"
                            ? () => openPicker(item.key as "model" | "harness" | "permissions")
                            : item.key === "new"
                              ? () => {
                                    // Mirrors the dock: the action runs, then the host clears the
                                    // command it consumed. No picker, so focus never leaves.
                                    setApplied("new session")
                                    clearCommand()
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
                        {picker === "harness" ? (
                            <div className="absolute bottom-full left-0 right-0 z-[1050] mb-2 origin-bottom animate-command-panel-in motion-reduce:animate-command-panel-fade">
                                <HarnessPickerPanel
                                    harnessIds={["pi_core", "claude", "codex"]}
                                    capabilities={MOCK_CAPABILITIES}
                                    currentHarness={harness}
                                    currentModel={model}
                                    onApply={(kind) => {
                                        setHarness(kind)
                                        setApplied(`harness → ${kind}`)
                                        setPicker(null)
                                        clearCommand()
                                    }}
                                    onDismiss={dismissPicker}
                                    onBackToCommands={backToCommands}
                                    onOpenConfig={() => setApplied("open config")}
                                />
                            </div>
                        ) : null}
                        {picker === "permissions" ? (
                            <div className="absolute bottom-full left-0 right-0 z-[1050] mb-2 origin-bottom animate-command-panel-in motion-reduce:animate-command-panel-fade">
                                <PermissionsPickerPanel
                                    current={permission}
                                    options={PERMISSION_POLICY_OPTIONS}
                                    onApply={(next) => {
                                        setPermission(next)
                                        setApplied(`permissions → ${next}`)
                                        setPicker(null)
                                        clearCommand()
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
                                clearCommand()
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
