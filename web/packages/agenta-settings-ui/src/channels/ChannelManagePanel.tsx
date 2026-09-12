import {useCallback, useEffect, useState} from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
    Alert,
    Button,
    Input,
    PasswordInput,
    Spinner,
    Switch,
} from "@agenta/ui/ui"
import {
    ArrowsLeftRight,
    ChatCircle,
    Hash,
    LinkBreak,
    Plus,
    UsersThree,
    Warning,
} from "@phosphor-icons/react"

import {
    NOOP_ACTIONS,
    answeringAgentName,
    botHandle,
    connectionScope,
    errorMessage,
    platformLabel,
} from "./helpers"
import type {
    ChannelBehaviorState,
    ChannelConnection,
    ChannelSetupField,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
    ChannelsActions,
} from "./types"

/**
 * The manage view for a connected channel: what is connected, where it answers, the two
 * behavior switches, who may message it, the read-only advanced defaults, and disconnect.
 * Shared by desktop + /m.
 *
 * Every mutation is real and goes through `ChannelsActions`. A rejected call leaves the panel
 * open, shows the message it carried, and the row it belongs to re-reads its own state, so the
 * screen never claims a change the backend refused.
 *
 * When the connection answers as another agent the panel shows the retarget offer instead, plus
 * the way out of the one-per-project rule: give this agent its own bot.
 */

export interface ChannelManagePanelProps {
    connection: ChannelConnection
    /** The agent whose page is open; decides whether the "connect here" offer shows. */
    agentId?: string
    agentName: string
    workspaceName?: string
    /** The hosted bot/app handle to show, e.g. "@newagentabot". */
    hostedHandle?: string
    /** The real actions; defaults to no-op actions for previews. */
    actions?: ChannelsActions
    /** Retarget this connection to the current agent. */
    onConnectHere: () => Promise<void>
    onDisconnect: () => Promise<void>
    /** Open the connect flow on the custom tab, so this agent gets a bot of its own. */
    onUseOwnBot?: () => void
    /** Open the connect flow again for this connection, to replace a dead install. */
    onReconnect?: () => void
}

/** The secret fields a token update asks for when the backend declares none. */
const FALLBACK_SECRETS: Record<"slack" | "telegram", ChannelSetupField[]> = {
    telegram: [{name: "bot_token", label: "Bot token", secret: true, required: true}],
    slack: [
        {name: "bot_token", label: "Bot User OAuth Token", secret: true, required: true},
        {name: "signing_secret", label: "Signing Secret", secret: true, required: true},
    ],
}

const formatDate = (iso: string | null | undefined): string | null => {
    if (!iso) return null
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"})
}

const spaceIcon = (kind: ChannelSpaceKind, isSlack: boolean) => {
    if (kind === "private") return <ChatCircle size={16} />
    return isSlack ? <Hash size={16} /> : <UsersThree size={16} />
}

const SECTION_TITLE = "text-[13px] font-semibold text-colorText"
const CARD = "overflow-hidden rounded-lg border border-solid border-colorBorderSecondary"
const DIVIDED = "border-0 border-t border-solid border-colorBorderSecondary"
const CHIP =
    "inline-flex h-6 flex-shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-solid border-colorBorder bg-colorBgContainer px-2.5 text-xs text-colorText"

const Section = ({title, action}: {title: string; action?: React.ReactNode}) => (
    <div className="flex items-center justify-between gap-2">
        <span className={SECTION_TITLE}>{title}</span>
        {action}
    </div>
)

export const ChannelManagePanel = ({
    connection,
    agentId,
    agentName,
    workspaceName = "your workspace",
    hostedHandle = "@agenta",
    actions = NOOP_ACTIONS,
    onConnectHere,
    onDisconnect,
    onUseOwnBot,
    onReconnect,
}: ChannelManagePanelProps) => {
    const isSlack = connection.platform === "slack"
    const name = platformLabel(connection.platform)
    const connectionId = connection.connectionId
    const handle = botHandle(connection, hostedHandle)

    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState<"disconnect" | "connect-here" | null>(null)
    const [error, setError] = useState<string | null>(null)

    const revoked = connection.status === "revoked"
    const scope = connectionScope(connection, agentId)
    const unassigned = scope === "unassigned"
    const elsewhere = scope === "elsewhere" || unassigned
    const otherAgent = unassigned ? "no agent" : answeringAgentName(connection)
    const connectedOn = formatDate(connection.connectedAt)
    // Only a custom install has secrets of its own to replace: a Telegram bot token, or a
    // Slack app's token and signing secret. A hosted install has none to show.
    const canUpdateToken = connection.kind === "custom"
    // Slack throws the whole install away rather than one secret, so a dead Slack app is
    // repaired by installing it again, custom or not.
    const revokedOffersToken = canUpdateToken && !isSlack

    // --- where it answers ------------------------------------------------------ //
    const [spaces, setSpaces] = useState<ChannelSpace[] | null>(null)
    const [spacesError, setSpacesError] = useState<string | null>(null)

    const loadSpaces = useCallback(async () => {
        if (!connectionId) return
        setSpacesError(null)
        try {
            setSpaces(await actions.listSpaces(connectionId))
        } catch (e) {
            setSpaces([])
            setSpacesError(errorMessage(e, `Could not load where ${name} answers.`))
        }
    }, [actions, connectionId, name])

    // --- the picker behind "Add channel" --------------------------------------- //
    const [pickerOpen, setPickerOpen] = useState(false)
    const [candidates, setCandidates] = useState<ChannelSpaceCandidate[] | null>(null)
    const [pickerError, setPickerError] = useState<string | null>(null)
    const [addingName, setAddingName] = useState<string | null>(null)

    const openPicker = async () => {
        if (!connectionId) return
        setPickerOpen(true)
        setCandidates(null)
        setPickerError(null)
        try {
            setCandidates(await actions.discoverSpaces(connectionId))
        } catch (e) {
            setCandidates([])
            setPickerError(errorMessage(e, "Could not list the channels this app can see."))
        }
    }

    const addCandidate = async (candidate: ChannelSpaceCandidate) => {
        if (!connectionId) return
        setAddingName(candidate.displayName)
        setPickerError(null)
        try {
            await actions.addSpace(connectionId, candidate)
            setPickerOpen(false)
            await loadSpaces()
        } catch (e) {
            setPickerError(errorMessage(e, "Could not add this channel."))
        } finally {
            setAddingName(null)
        }
    }

    // --- the two behavior switches --------------------------------------------- //
    const [behavior, setBehavior] = useState<ChannelBehaviorState | null>(null)
    const [behaviorSaving, setBehaviorSaving] = useState<"dm" | "group" | null>(null)
    const [behaviorError, setBehaviorError] = useState<string | null>(null)

    const loadBehavior = useCallback(async () => {
        if (!connectionId) return
        setBehaviorError(null)
        try {
            setBehavior(await actions.readBehavior(connection.platform, connectionId))
        } catch (e) {
            setBehavior(null)
            setBehaviorError(errorMessage(e, "Could not read where this agent may answer."))
        }
    }, [actions, connectionId, connection.platform])

    const toggleBehavior = async (key: "dm" | "group", value: boolean) => {
        if (!connectionId || !behavior) return
        const next = {...behavior, [key]: value}
        setBehavior(next)
        setBehaviorSaving(key)
        setBehaviorError(null)
        try {
            await actions.writeBehavior(connection.platform, connectionId, next)
        } catch (e) {
            setBehaviorError(errorMessage(e, "Could not save this setting."))
        } finally {
            setBehaviorSaving(null)
            // The grants are the truth, not the switch: re-read whether the write landed or not.
            await loadBehavior()
        }
    }

    // --- allowed Telegram accounts --------------------------------------------- //
    const [allowed, setAllowed] = useState<string[] | null>(null)
    const [allowedEditing, setAllowedEditing] = useState(false)
    const [allowedDraft, setAllowedDraft] = useState("")
    const [allowedSaving, setAllowedSaving] = useState(false)
    const [allowedSaved, setAllowedSaved] = useState(false)
    const [allowedError, setAllowedError] = useState<string | null>(null)

    const loadAllowed = useCallback(async () => {
        if (!connectionId) return
        try {
            setAllowed(await actions.readAllowedUsers(connectionId))
        } catch {
            setAllowed([])
        }
    }, [actions, connectionId])

    useEffect(() => {
        if (!allowedSaved) return
        const timer = setTimeout(() => setAllowedSaved(false), 2000)
        return () => clearTimeout(timer)
    }, [allowedSaved])

    const saveAllowed = async () => {
        if (!connectionId) return
        const ids = Array.from(
            new Set(
                allowedDraft
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
            ),
        )
        setAllowedSaving(true)
        setAllowedError(null)
        try {
            await actions.writeAllowedUsers(connectionId, ids)
            setAllowed(ids)
            setAllowedEditing(false)
            setAllowedSaved(true)
        } catch (e) {
            setAllowedError(errorMessage(e, "Could not save the allowed accounts."))
        } finally {
            setAllowedSaving(false)
        }
    }

    // --- replacing the secrets of a custom install ------------------------------ //
    const [tokenOpen, setTokenOpen] = useState(false)
    const [tokenFields, setTokenFields] = useState<ChannelSetupField[] | null>(null)
    const [tokenValues, setTokenValues] = useState<Record<string, string>>({})
    const [tokenSaving, setTokenSaving] = useState(false)
    const [tokenSaved, setTokenSaved] = useState(false)
    const [tokenError, setTokenError] = useState<string | null>(null)

    const openTokenForm = async () => {
        setTokenOpen(true)
        setTokenError(null)
        setTokenSaved(false)
        if (tokenFields) return
        try {
            const setup = await actions.loadSetup(connection.platform)
            const secrets = setup.fields.filter((field) => field.secret)
            setTokenFields(secrets.length ? secrets : FALLBACK_SECRETS[connection.platform])
        } catch {
            setTokenFields(FALLBACK_SECRETS[connection.platform])
        }
    }

    const saveToken = async () => {
        if (!connectionId || !tokenFields) return
        setTokenSaving(true)
        setTokenError(null)
        try {
            const credentials: Record<string, string> = {}
            for (const field of tokenFields) {
                const value = tokenValues[field.name]?.trim()
                if (value) credentials[field.name] = value
            }
            await actions.updateCredentials(connectionId, credentials)
            setTokenValues({})
            setTokenOpen(false)
            setTokenSaved(true)
            // A good secret revives the connection, and the status row is the host's copy of
            // it. Re-read so the red alert goes away without closing the panel.
            await actions.reload().catch(() => {
                /* the save landed; a stale status row is not worth an error */
            })
        } catch (e) {
            setTokenError(errorMessage(e, `${name} rejected the new credentials.`))
        } finally {
            setTokenSaving(false)
        }
    }

    const tokenValid = (tokenFields ?? []).every(
        (field) => !field.required || tokenValues[field.name]?.trim(),
    )

    // The panel only owns this state when the connection answers here: everything below
    // hangs off this agent's channel agent row, which an "elsewhere" connection does not have.
    useEffect(() => {
        if (elsewhere || !connectionId) return
        void loadSpaces()
        void loadBehavior()
        if (!isSlack) void loadAllowed()
    }, [elsewhere, connectionId, isSlack, loadSpaces, loadBehavior, loadAllowed])

    const run = async (kind: "disconnect" | "connect-here", action: () => Promise<void>) => {
        setBusy(kind)
        setError(null)
        try {
            await action()
        } catch (e) {
            setError(
                errorMessage(
                    e,
                    kind === "disconnect"
                        ? `Could not disconnect ${name}. Try again.`
                        : `Could not connect ${name} to ${agentName}. Try again.`,
                ),
            )
        } finally {
            setBusy(null)
        }
    }

    const statusRow = (
        <span
            className={`inline-flex items-center gap-1.5 ${revoked ? "text-colorError" : ""}`}
            data-testid="channels-status"
        >
            <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                    revoked ? "bg-colorError" : "bg-colorSuccess"
                }`}
            />
            {revoked ? (isSlack ? "Uninstalled" : "Token revoked") : "Active"}
        </span>
    )

    const summaryRows: {label: string; value: React.ReactNode}[] = [
        {
            label: "Bot",
            value: `${handle} · ${
                connection.kind === "hosted"
                    ? "Agenta-hosted"
                    : isSlack
                      ? "Your own app"
                      : "Your own bot"
            }`,
        },
        isSlack
            ? {label: "Workspace", value: workspaceName}
            : {label: "Account", value: "Linked to you"},
        ...(canUpdateToken
            ? [
                  {
                      label: "Token",
                      value: (
                          <span className="inline-flex items-center gap-2">
                              <span className="tracking-widest text-colorTextSecondary">
                                  ••••••••••••
                              </span>
                              <button
                                  type="button"
                                  className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorTextSecondary underline underline-offset-2"
                                  onClick={() => void openTokenForm()}
                                  data-testid="channels-update-token"
                              >
                                  Update
                              </button>
                          </span>
                      ),
                  },
              ]
            : []),
        {label: "Status", value: statusRow},
        ...(connectedOn ? [{label: "Connected", value: connectedOn}] : []),
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
            "What makes the agent respond in a channel",
            isSlack ? "@mention only" : "Mention or reply",
        ],
        ["Session memory", "How far a conversation is remembered", "Per thread"],
        ["Read earlier messages", "Include messages sent before the agent was added", "Off"],
        ["Read while thinking", "Include messages that arrive while it is answering", "On"],
    ]

    const tokenForm = tokenOpen ? (
        <div
            className="flex flex-col gap-3 rounded-lg border border-solid border-colorBorderSecondary p-3"
            data-testid="channels-token-form"
        >
            {tokenError ? <Alert type="error" showIcon message={tokenError} /> : null}
            {tokenFields ? (
                tokenFields.map((field) => (
                    <label key={field.name} className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-colorText">
                            {field.label}
                        </span>
                        <PasswordInput
                            value={tokenValues[field.name] ?? ""}
                            onChange={(e) =>
                                setTokenValues((values) => ({
                                    ...values,
                                    [field.name]: e.target.value,
                                }))
                            }
                            className="font-mono text-xs"
                            data-testid={`channels-token-${field.name}`}
                        />
                    </label>
                ))
            ) : (
                <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                    <Spinner size="small" /> Loading the {name} setup…
                </div>
            )}
            <div className="flex justify-end gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={tokenSaving}
                    onClick={() => setTokenOpen(false)}
                >
                    Cancel
                </Button>
                <Button
                    size="sm"
                    disabled={!tokenFields || !tokenValid || tokenSaving}
                    onClick={() => void saveToken()}
                    data-testid="channels-token-save"
                >
                    {tokenSaving ? <Spinner size="small" /> : null}
                    Save
                </Button>
            </div>
        </div>
    ) : null

    return (
        <div className="flex flex-col gap-5">
            {error ? <Alert type="error" showIcon message={error} /> : null}

            {revoked && !elsewhere ? (
                <div
                    className="flex items-start gap-2.5 rounded-lg border border-solid border-colorErrorBorder bg-colorErrorBg p-3"
                    data-testid="channels-revoked"
                >
                    <Warning size={16} className="mt-0.5 flex-shrink-0 text-colorError" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-colorText">
                            {revokedOffersToken
                                ? "Telegram revoked the bot token"
                                : `${name} uninstalled the app`}
                        </span>
                        <span className="text-xs leading-relaxed text-colorTextSecondary">
                            {revokedOffersToken
                                ? `${agentName} cannot answer there until you paste a new token from @BotFather.`
                                : `${agentName} cannot answer there until the app is installed again.`}
                        </span>
                        {revokedOffersToken ? (
                            tokenOpen ? null : (
                                <div>
                                    <Button size="sm" onClick={() => void openTokenForm()}>
                                        Update token
                                    </Button>
                                </div>
                            )
                        ) : onReconnect ? (
                            <div>
                                <Button size="sm" onClick={onReconnect}>
                                    Reconnect
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {revoked && !elsewhere && tokenOpen ? tokenForm : null}

            {elsewhere ? (
                <>
                    <div className="flex flex-col gap-4" data-testid="channels-connect-here">
                        <div className="flex items-start gap-2.5">
                            <ArrowsLeftRight
                                size={18}
                                className="mt-0.5 flex-shrink-0 text-colorTextSecondary"
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="text-[15px] font-semibold text-colorText">
                                    {unassigned
                                        ? `${name} is connected, but answers as no agent yet`
                                        : `${name} is connected to ${otherAgent}`}
                                </span>
                                <span className="text-[13px] leading-relaxed text-colorTextSecondary">
                                    One {name} connection per project, and it answers as one agent.
                                    {unassigned
                                        ? ` Connect it here so ${agentName} answers.`
                                        : ` Connecting it here makes ${agentName} answer instead of ${otherAgent}. The linked chats stay linked.`}
                                </span>
                            </div>
                        </div>
                        <Button
                            variant="default"
                            className="w-full"
                            disabled={busy !== null}
                            onClick={() => void run("connect-here", onConnectHere)}
                        >
                            {busy === "connect-here" ? <Spinner size="small" /> : null}
                            {unassigned
                                ? `Connect ${agentName}`
                                : `Disconnect from ${otherAgent} and connect here`}
                        </Button>
                    </div>

                    {onUseOwnBot ? (
                        <div
                            className={`flex flex-col gap-3 pt-4 ${DIVIDED}`}
                            data-testid="channels-own-bot-offer"
                        >
                            <span className="text-xs leading-relaxed text-colorTextSecondary">
                                The one-per-project rule applies to the Agenta bot only. {agentName}{" "}
                                can have its own bot instead
                                {unassigned ? "" : `, and ${otherAgent} keeps the Agenta bot`}.
                            </span>
                            <Button
                                variant="outline"
                                className="w-full"
                                disabled={busy !== null}
                                onClick={onUseOwnBot}
                            >
                                Use your own bot for {agentName}
                            </Button>
                        </div>
                    ) : null}
                </>
            ) : (
                <>
                    <div className={CARD}>
                        {summaryRows.map(({label, value}, i) => (
                            <div
                                key={label}
                                className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                                    i ? DIVIDED : ""
                                }`}
                            >
                                <span className="text-xs text-colorTextSecondary">{label}</span>
                                <span className="truncate text-right text-[13px] text-colorText">
                                    {value}
                                </span>
                            </div>
                        ))}
                    </div>

                    {!revoked && tokenOpen ? tokenForm : null}
                    {tokenSaved ? (
                        <Alert type="success" showIcon message="The new credentials were saved." />
                    ) : null}

                    {/* --- where it answers --- */}
                    <div className="flex flex-col gap-2">
                        <Section
                            title="Answers in"
                            action={
                                isSlack && !pickerOpen ? (
                                    <button
                                        type="button"
                                        className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs text-colorText"
                                        onClick={() => void openPicker()}
                                        data-testid="channels-add-space"
                                    >
                                        <Plus size={12} weight="bold" />
                                        Add channel
                                    </button>
                                ) : null
                            }
                        />
                        {spacesError ? <Alert type="error" showIcon message={spacesError} /> : null}
                        <div className={CARD}>
                            {spaces === null ? (
                                <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-colorTextSecondary">
                                    <Spinner size="small" /> Loading…
                                </div>
                            ) : spaces.length === 0 ? (
                                <div className="px-3 py-2.5 text-xs text-colorTextSecondary">
                                    Nothing yet. {isSlack ? "Add a channel" : "Open a chat"} and it
                                    appears here.
                                </div>
                            ) : (
                                spaces.map((space, i) => (
                                    <div
                                        key={space.id}
                                        className={`flex items-center gap-2.5 px-3 py-2.5 ${
                                            i ? DIVIDED : ""
                                        }`}
                                    >
                                        <span className="flex flex-shrink-0 text-colorTextSecondary">
                                            {spaceIcon(space.kind, isSlack)}
                                        </span>
                                        <span className="truncate text-[13px] text-colorText">
                                            {space.name}
                                        </span>
                                    </div>
                                ))
                            )}

                            {pickerOpen ? (
                                <div
                                    className={`flex flex-col gap-2 bg-colorFillQuaternary p-3 ${DIVIDED}`}
                                    data-testid="channels-space-picker"
                                >
                                    <span className="text-xs text-colorTextSecondary">
                                        Pick a channel the app was added to.
                                    </span>
                                    {pickerError ? (
                                        <Alert type="error" showIcon message={pickerError} />
                                    ) : null}
                                    {candidates === null ? (
                                        <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                                            <Spinner size="small" /> Looking…
                                        </div>
                                    ) : candidates.filter((c) => !c.isConfigured).length === 0 ? (
                                        <span className="text-xs text-colorTextTertiary">
                                            No new channels. Add the app to a channel in Slack
                                            first.
                                        </span>
                                    ) : (
                                        <div className="flex flex-col gap-1.5">
                                            {candidates
                                                .filter((candidate) => !candidate.isConfigured)
                                                .map((candidate) => (
                                                    <button
                                                        key={`${candidate.kind}-${candidate.displayName}`}
                                                        type="button"
                                                        disabled={addingName !== null}
                                                        onClick={() => void addCandidate(candidate)}
                                                        className="flex cursor-pointer items-center gap-2.5 rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer px-2.5 py-2 text-left disabled:cursor-default"
                                                    >
                                                        <span className="flex flex-shrink-0 text-colorTextSecondary">
                                                            {spaceIcon(candidate.kind, isSlack)}
                                                        </span>
                                                        <span className="flex-1 truncate text-[13px] text-colorText">
                                                            {candidate.displayName}
                                                        </span>
                                                        {addingName === candidate.displayName ? (
                                                            <Spinner size="small" />
                                                        ) : null}
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                    <div className="flex justify-end">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={addingName !== null}
                                            onClick={() => setPickerOpen(false)}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        {isSlack ? null : (
                            <span className="text-xs leading-relaxed text-colorTextTertiary">
                                Add {handle} to a group in Telegram and mention it once. The group
                                appears here. Private chats appear on first message.
                            </span>
                        )}
                    </div>

                    {/* --- the two switches --- */}
                    <div className="flex flex-col gap-2">
                        <Section title="Behavior" />
                        {behaviorError ? (
                            <Alert type="error" showIcon message={behaviorError} />
                        ) : null}
                        <div className={CARD}>
                            {behaviorRows.map((row, i) => (
                                <div
                                    key={row.key}
                                    className={`flex items-center gap-3 px-3 py-3 ${i ? DIVIDED : ""}`}
                                >
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="text-[13px] font-medium text-colorText">
                                            {row.title}
                                        </span>
                                        <span className="text-xs leading-normal text-colorTextSecondary">
                                            {row.help}
                                        </span>
                                    </span>
                                    {behaviorSaving === row.key ? <Spinner size="small" /> : null}
                                    <Switch
                                        size="sm"
                                        checked={behavior?.[row.key] ?? true}
                                        disabled={behavior === null || behaviorSaving !== null}
                                        onCheckedChange={(value) =>
                                            void toggleBehavior(row.key, value)
                                        }
                                        aria-label={row.title}
                                        data-testid={`channels-behavior-${row.key}`}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* --- who may message the bot (Telegram only) --- */}
                    {isSlack ? null : (
                        <div className={`flex flex-col gap-2 ${CARD} p-3`}>
                            <div className="flex items-center gap-3">
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="text-[13px] font-medium text-colorText">
                                        Allowed users
                                    </span>
                                    <span className="text-xs leading-normal text-colorTextSecondary">
                                        Only these Telegram accounts can message the bot.
                                    </span>
                                </span>
                                {allowedSaved ? (
                                    <span className="text-xs text-colorSuccess">Saved</span>
                                ) : null}
                                {allowedEditing ? null : (
                                    <>
                                        <span className="text-[13px] text-colorText">
                                            {allowed === null
                                                ? "…"
                                                : allowed.length === 0
                                                  ? "Everyone"
                                                  : `${allowed.length} account${
                                                        allowed.length > 1 ? "s" : ""
                                                    }`}
                                        </span>
                                        <button
                                            type="button"
                                            className={`${CHIP} cursor-pointer`}
                                            onClick={() => {
                                                setAllowedDraft((allowed ?? []).join(", "))
                                                setAllowedError(null)
                                                setAllowedEditing(true)
                                            }}
                                            data-testid="channels-allowed-edit"
                                        >
                                            Edit
                                        </button>
                                    </>
                                )}
                            </div>
                            {allowedEditing ? (
                                <div className="flex flex-col gap-2">
                                    {allowedError ? (
                                        <Alert type="error" showIcon message={allowedError} />
                                    ) : null}
                                    <Input
                                        value={allowedDraft}
                                        onChange={(e) => setAllowedDraft(e.target.value)}
                                        placeholder="123456789, 987654321"
                                        className="font-mono text-xs"
                                        data-testid="channels-allowed-input"
                                    />
                                    <span className="text-xs text-colorTextTertiary">
                                        Comma-separated Telegram user IDs from @userinfobot. Leave
                                        it empty and anyone who finds the bot can talk to{" "}
                                        {agentName}.
                                    </span>
                                    <div className="flex justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={allowedSaving}
                                            onClick={() => setAllowedEditing(false)}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            disabled={allowedSaving}
                                            onClick={() => void saveAllowed()}
                                            data-testid="channels-allowed-save"
                                        >
                                            {allowedSaving ? <Spinner size="small" /> : null}
                                            Save
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}

                    {/* --- the shipped defaults, read-only --- */}
                    <Accordion type="single" collapsible>
                        <AccordionItem value="advanced">
                            <AccordionTrigger>Advanced</AccordionTrigger>
                            <AccordionContent>
                                <div className="flex flex-col">
                                    {advancedRows.map(([title, help, value], i) => (
                                        <div
                                            key={title}
                                            className={`flex items-center gap-3 px-3 py-2.5 ${
                                                i ? DIVIDED : ""
                                            }`}
                                        >
                                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                <span className="text-[13px] text-colorText">
                                                    {title}
                                                </span>
                                                <span className="text-xs text-colorTextSecondary">
                                                    {help}
                                                </span>
                                            </span>
                                            <span className={CHIP}>{value}</span>
                                        </div>
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>

                    <div className={`flex flex-col gap-2 pt-4 ${DIVIDED}`}>
                        {confirming ? (
                            <div className="flex flex-col gap-3 rounded-lg border border-solid border-colorBorderSecondary p-3">
                                <span className="text-xs leading-relaxed text-colorTextSecondary">
                                    Disconnect {name}? {agentName} stops answering there. Past
                                    conversations stay in Agenta.
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy !== null}
                                        onClick={() => setConfirming(false)}
                                    >
                                        Keep
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        disabled={busy !== null}
                                        onClick={() => void run("disconnect", onDisconnect)}
                                        data-testid="channels-disconnect-confirm"
                                    >
                                        {busy === "disconnect" ? <Spinner size="small" /> : null}
                                        Disconnect
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button
                                variant="destructive-outline"
                                disabled={busy !== null}
                                onClick={() => setConfirming(true)}
                                data-testid="channels-disconnect"
                            >
                                <LinkBreak size={14} />
                                Disconnect {name}
                            </Button>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
