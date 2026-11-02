import {useState} from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
    Button,
    Combobox,
    Input,
    Segmented,
} from "@agenta/ui/ui"
import {ChatCircle, Hash, LinkBreak, Plus, UsersThree, Warning} from "@phosphor-icons/react"

import {botHandle, platformLabel} from "./helpers"
import type {ChannelBehavior, ChannelChat, ChannelConnection, ChannelChatType} from "./types"

/**
 * The manage view for a connected channel: status summary, the chats it answers in, the two
 * behavior switches, the collapsed Advanced section, and disconnect. Shared by desktop + /m.
 *
 * FIRST PASS: every mutation edits the connection object the host holds in local state. No
 * api-client calls. Advanced is display-only (read-only value chips) this pass.
 */

export interface ChannelManagePanelProps {
    connection: ChannelConnection
    agentName: string
    workspaceName?: string
    onChange: (next: ChannelConnection) => void
    onDisconnect: () => void
}

const behaviorOptions = [
    {label: "Allow", value: "allow"},
    {label: "Deny", value: "deny"},
]

const chatIcon = (type: ChannelChatType) => {
    if (type === "channel") return <Hash size={16} />
    if (type === "group") return <UsersThree size={16} />
    return <ChatCircle size={16} />
}

const EXISTING_CHANNEL_OPTIONS = [
    {value: "#support", label: "#support"},
    {value: "#eng-oncall", label: "#eng-oncall"},
    {value: "#general", label: "#general"},
    {value: "#sales-questions", label: "#sales-questions"},
]

export const ChannelManagePanel = ({
    connection,
    agentName,
    workspaceName = "your workspace",
    onChange,
    onDisconnect,
}: ChannelManagePanelProps) => {
    const isSlack = connection.platform === "slack"
    const name = platformLabel(connection.platform)

    const [adding, setAdding] = useState(false)
    const [addTab, setAddTab] = useState<"existing" | "new">("existing")
    const [pickedChannel, setPickedChannel] = useState("")
    const [newChannel, setNewChannel] = useState("")
    const [confirming, setConfirming] = useState(false)

    const revoked = connection.status === "revoked"
    const removedChats = connection.chats.filter((chat) => chat.removed)
    const hasIssue = revoked || removedChats.length > 0

    const setBehavior = (key: "dm" | "group", value: ChannelBehavior) =>
        onChange({...connection, [key]: value})

    const clearRemoved = () =>
        onChange({
            ...connection,
            chats: connection.chats.map((chat) => ({...chat, removed: false})),
        })

    const readdChat = (index: number) =>
        onChange({
            ...connection,
            chats: connection.chats.map((chat, i) =>
                i === index ? {...chat, removed: false} : chat,
            ),
        })

    const addChat = () => {
        const chatName =
            addTab === "existing" ? pickedChannel : `#${newChannel.trim().replace(/^#/, "")}`
        const next = connection.chats.slice()
        const dmIndex = next.findIndex((chat) => chat.type === "dm")
        const chat: ChannelChat = {name: chatName, type: "channel"}
        next.splice(dmIndex < 0 ? next.length : dmIndex, 0, chat)
        onChange({...connection, chats: next})
        setPickedChannel("")
        setNewChannel("")
        setAdding(false)
    }

    const summaryRows: [string, string][] = [
        [
            "Bot",
            connection.kind === "hosted"
                ? "@agenta · Agenta-hosted"
                : `${botHandle(connection)} · your own ${isSlack ? "app" : "bot"}`,
        ],
        [
            isSlack ? "Workspace" : "Account",
            isSlack ? workspaceName : "Linked to you · 2 allowed users",
        ],
        ["Connected", "12 Aug 2026"],
    ]

    const behaviorRows: {key: "dm" | "group"; title: string; help: string}[] = [
        {
            key: "dm",
            title: "Direct messages",
            help: "Whether this agent answers a direct message opened with it.",
        },
        {
            key: "group",
            title: isSlack ? "Channels and group chats" : "Group chats",
            help: isSlack
                ? "Whether this agent answers when mentioned in a channel it has been added to."
                : "Whether this agent answers in a group it has been added to.",
        },
    ]

    const advancedRows: [string, string, string][] = [
        [
            "Message triggers",
            "What makes the agent respond in a group",
            isSlack ? "@mention only" : "Mention or reply",
        ],
        ["Session memory", "How far a conversation is remembered", "Per thread"],
        ["Read earlier messages", "Include messages sent before the agent was added", "Off"],
        ["Read while thinking", "Include messages that arrive while it is answering", "On"],
    ]

    const noChannelsYet =
        isSlack && !adding && !connection.chats.some((chat) => chat.type === "channel")

    return (
        <div className="flex flex-col gap-5">
            {/* hero / status */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="m-0 text-lg font-semibold text-colorText">{name}</h2>
                    <p className="m-0 text-[13px] text-colorTextSecondary">
                        {agentName} · {isSlack ? workspaceName : "Telegram"}
                    </p>
                </div>
                <span
                    className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs ${
                        revoked
                            ? "bg-colorErrorBg text-colorError"
                            : removedChats.length
                              ? "bg-colorWarningBg text-colorWarning"
                              : "bg-colorSuccessBg text-colorSuccess"
                    }`}
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {revoked
                        ? "Credential revoked"
                        : removedChats.length
                          ? "Needs attention"
                          : "Connected"}
                </span>
            </div>

            {hasIssue ? (
                <div
                    className={`flex items-start gap-2.5 rounded-lg border border-solid p-3.5 ${
                        revoked
                            ? "border-colorErrorBorder bg-colorErrorBg"
                            : "border-colorWarningBorder bg-colorWarningBg"
                    }`}
                >
                    <Warning
                        size={16}
                        weight="fill"
                        className={`mt-0.5 flex-shrink-0 ${
                            revoked ? "text-colorError" : "text-colorWarning"
                        }`}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                            className={`text-[13px] font-medium ${
                                revoked ? "text-colorError" : "text-colorWarning"
                            }`}
                        >
                            {revoked
                                ? `${name} rejected the app’s credentials`
                                : `Someone removed @agenta from ${removedChats[0]?.name ?? "a channel"}`}
                        </span>
                        <span className="text-xs leading-normal text-colorTextSecondary">
                            {revoked
                                ? "The client secret was rotated or the app was uninstalled. Reconnect to pick up where it left off."
                                : "The agent no longer sees messages there. Re-add it from the list below."}
                        </span>
                    </div>
                    <Button size="sm" onClick={revoked ? onDisconnect : clearRemoved}>
                        {revoked ? "Reconnect" : "Re-add"}
                    </Button>
                </div>
            ) : null}

            {/* summary */}
            <div className="overflow-hidden rounded-lg border border-solid border-colorBorderSecondary text-[13px]">
                {summaryRows.map(([label, value], i) => (
                    <div
                        key={label}
                        className={`grid grid-cols-[140px_1fr] ${
                            i ? "border-0 border-t border-solid border-colorBorderSecondary" : ""
                        }`}
                    >
                        <div className="border-0 border-r border-solid border-colorBorderSecondary bg-colorFillQuaternary px-3 py-2 text-colorTextTertiary">
                            {label}
                        </div>
                        <div className="truncate px-3 py-2 text-colorText">{value}</div>
                    </div>
                ))}
            </div>

            {/* chats */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-colorText">
                        {isSlack ? "Connected chats" : "Where it answers"}
                    </span>
                    {isSlack ? (
                        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                            <Plus size={13} weight="bold" />
                            Add channel
                        </Button>
                    ) : null}
                </div>

                {adding ? (
                    <div className="flex flex-col gap-3 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3.5">
                        <Segmented
                            block
                            value={addTab}
                            onChange={(value) => setAddTab(value as "existing" | "new")}
                            options={[
                                {label: "Existing channel", value: "existing"},
                                {label: "New channel", value: "new"},
                            ]}
                        />
                        {addTab === "existing" ? (
                            <label className="flex flex-col gap-1.5">
                                <span className="text-[13px] font-medium text-colorText">
                                    Channel
                                </span>
                                <Combobox
                                    value={pickedChannel}
                                    onChange={(value) => setPickedChannel(value ?? "")}
                                    options={EXISTING_CHANNEL_OPTIONS}
                                    placeholder="Search channels…"
                                />
                                <span className="rounded-md bg-colorFillQuaternary px-3 py-2.5 text-xs leading-relaxed text-colorTextSecondary">
                                    Adds @agenta to the channel you pick. {agentName} answers when
                                    someone mentions it there.
                                </span>
                            </label>
                        ) : (
                            <label className="flex flex-col gap-1.5">
                                <span className="text-[13px] font-medium text-colorText">
                                    Channel name
                                </span>
                                <Input
                                    value={newChannel}
                                    onChange={(e) => setNewChannel(e.target.value)}
                                    placeholder="agent-support"
                                />
                                <span className="rounded-md bg-colorFillQuaternary px-3 py-2.5 text-xs leading-relaxed text-colorTextSecondary">
                                    Creates the channel in {workspaceName} and adds @agenta to it.
                                </span>
                            </label>
                        )}
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setAdding(false)}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                disabled={
                                    addTab === "existing" ? !pickedChannel : !newChannel.trim()
                                }
                                onClick={addChat}
                            >
                                {addTab === "existing" ? "Add channel" : "Create and add"}
                            </Button>
                        </div>
                    </div>
                ) : null}

                {noChannelsYet ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-colorBorderSecondary px-3.5 py-3 text-xs leading-normal text-colorTextSecondary">
                        <span>
                            {agentName} answers direct messages only. Add a channel so your team can
                            mention @agenta there.
                        </span>
                        <Button size="sm" onClick={() => setAdding(true)}>
                            <Plus size={13} weight="bold" />
                            Add channel
                        </Button>
                    </div>
                ) : null}

                {connection.chats.length ? (
                    <div className="overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
                        {connection.chats.map((chat, i) => (
                            <div
                                key={`${chat.name}-${i}`}
                                className={`flex items-center gap-2.5 px-3 py-2.5 ${
                                    i
                                        ? "border-0 border-t border-solid border-colorBorderSecondary"
                                        : ""
                                } ${chat.removed ? "bg-colorWarningBg" : ""}`}
                            >
                                <span className="flex flex-shrink-0 text-colorTextTertiary">
                                    {chatIcon(chat.type)}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="truncate text-[13px] text-colorText">
                                        {chat.name}
                                    </span>
                                    <span className="text-xs text-colorTextTertiary">
                                        {chat.type === "dm"
                                            ? connection.dm === "allow"
                                                ? "Anyone can message the agent"
                                                : "Denied by the switch below"
                                            : chat.type === "group"
                                              ? "Group chat"
                                              : "Answers when @mentioned"}
                                    </span>
                                </span>
                                {chat.removed ? (
                                    <>
                                        <span className="rounded bg-colorErrorBg px-1.5 py-0.5 text-xs text-colorError">
                                            Bot removed
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => readdChat(i)}
                                        >
                                            Re-add
                                        </Button>
                                    </>
                                ) : chat.type !== "dm" ? (
                                    <span className="text-xs text-colorTextTertiary">Active</span>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>

            {/* behavior switches */}
            <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-colorText">Behavior</span>
                <div className="overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
                    {behaviorRows.map((row, i) => (
                        <div
                            key={row.key}
                            className={`flex items-center gap-4 px-3.5 py-3 ${
                                i
                                    ? "border-0 border-t border-solid border-colorBorderSecondary"
                                    : ""
                            }`}
                        >
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-[13px] font-medium text-colorText">
                                    {row.title}
                                </span>
                                <span className="text-xs leading-normal text-colorTextSecondary">
                                    {row.help}
                                </span>
                            </span>
                            <Segmented
                                value={connection[row.key]}
                                onChange={(value) => setBehavior(row.key, value as ChannelBehavior)}
                                options={behaviorOptions}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* advanced */}
            <Accordion type="single" collapsible>
                <AccordionItem value="advanced">
                    <AccordionTrigger>Advanced</AccordionTrigger>
                    <AccordionContent>
                        <div className="flex flex-col">
                            {advancedRows.map(([title, help, value], i) => (
                                <div
                                    key={title}
                                    className={`flex items-center gap-4 px-1 py-2.5 ${
                                        i
                                            ? "border-0 border-t border-solid border-colorBorderSecondary"
                                            : ""
                                    }`}
                                >
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="text-[13px] text-colorText">{title}</span>
                                        <span className="text-xs text-colorTextTertiary">
                                            {help}
                                        </span>
                                    </span>
                                    <span className="inline-flex flex-shrink-0 items-center rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer px-2.5 py-1 text-xs text-colorText">
                                        {value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            {/* disconnect */}
            <div className="flex flex-col gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-3">
                {confirming ? (
                    <div className="flex flex-col gap-2.5 rounded-lg border border-solid border-colorErrorBorder bg-colorErrorBg p-3.5">
                        <span className="text-[13px] leading-normal text-colorText">
                            Disconnect {name}? {agentName} stops answering there. Past conversations
                            stay in Sessions.
                        </span>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirming(false)}
                            >
                                Cancel
                            </Button>
                            <Button variant="destructive" size="sm" onClick={onDisconnect}>
                                Disconnect
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="self-start text-colorError"
                        onClick={() => setConfirming(true)}
                    >
                        <LinkBreak size={14} />
                        Disconnect {name}
                    </Button>
                )}
            </div>
        </div>
    )
}
