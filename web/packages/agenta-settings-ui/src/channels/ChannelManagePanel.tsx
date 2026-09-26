import {useCallback, useEffect, useState} from "react"

import {
    Alert,
    Button,
    Input,
    PasswordInput,
    RadioGroup,
    RadioGroupItem,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Spinner,
    Switch,
} from "@agenta/ui/ui"
import {
    ArrowSquareOut,
    ArrowsLeftRight,
    ChatCircle,
    Hash,
    Plus,
    UsersThree,
    Warning,
    X,
} from "@phosphor-icons/react"

import {nameSpacesFrom} from "./actions"
import {ChannelAdvancedSection} from "./ChannelAdvancedSection"
import {
    NOOP_ACTIONS,
    ROW_BUTTON,
    answeringAgentName,
    botHandle,
    connectionKindLabel,
    connectionRowText,
    connectionScope,
    disconnectSubject,
    errorMessage,
    formatConnectedOn,
    platformLabel,
    slackInviteHandle,
} from "./helpers"
import {platformLogo} from "./icons"
import {PanelFooter} from "./PanelFooter"
import type {
    ChannelBehaviorState,
    ChannelConnection,
    ChannelPlatform,
    ChannelSetupField,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
    ChannelsActions,
} from "./types"
import {WhatsAppWebhook} from "./WhatsAppWebhook"

/**
 * The manage view for a connected channel: where it answers, who may message it, its
 * credentials, the Advanced channel tool settings, and disconnect. Every change saves through `ChannelsActions` at once; a rejected
 * call shows its message next to the row and the row re-reads its own state.
 *
 * When the connection answers as another agent the panel offers to move it here instead, or to
 * give this agent a bot of its own.
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
    /** Start another connection on this platform. */
    onAdd?: () => void
    /** Open the connect flow on the custom method, so this agent gets a bot of its own. */
    onUseOwnBot?: () => void
    /** Open the connect flow again for this connection, to replace a dead install. */
    onReconnect?: () => void
}

/** The secret fields a token update asks for when the backend declares none. */
const FALLBACK_SECRETS: Record<ChannelPlatform, ChannelSetupField[]> = {
    telegram: [{name: "bot_token", label: "Bot token", secret: true, required: true}],
    whatsapp: [
        {name: "access_token", label: "Access token", secret: true, required: true},
        {name: "app_secret", label: "App secret", secret: true, required: true},
    ],
    slack: [
        {name: "bot_token", label: "Bot User OAuth Token", secret: true, required: true},
        {name: "signing_secret", label: "Signing Secret", secret: true, required: true},
    ],
}

const spaceIcon = (kind: ChannelSpaceKind, isSlack: boolean) => {
    if (kind === "private") return <ChatCircle size={15} />
    return isSlack ? <Hash size={15} /> : <UsersThree size={15} />
}

const SECTION_TITLE = "pb-1 text-[13px] font-semibold text-foreground"
const ROW = "border-0 border-b border-solid border-border py-3"

export const ChannelManagePanel = ({
    connection,
    agentId,
    agentName,
    hostedHandle = "@agenta",
    actions = NOOP_ACTIONS,
    onConnectHere,
    onDisconnect,
    onAdd,
    onUseOwnBot,
    onReconnect,
}: ChannelManagePanelProps) => {
    const isSlack = connection.platform === "slack"
    const isTelegram = connection.platform === "telegram"
    const isWhatsApp = connection.platform === "whatsapp"
    const name = platformLabel(connection.platform)
    const connectionId = connection.connectionId
    const handle = botHandle(connection, hostedHandle)
    const inviteHandle = slackInviteHandle(connection)

    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState<"disconnect" | "connect-here" | null>(null)
    // Which action failed decides where its message shows: next to the button that ran it.
    const [error, setError] = useState<{
        kind: "disconnect" | "connect-here"
        message: string
    } | null>(null)

    const revoked = connection.status === "revoked"
    const scope = connectionScope(connection, agentId)
    const unassigned = scope === "unassigned"
    const elsewhere = scope === "elsewhere" || unassigned
    const otherAgent = unassigned ? "no agent" : answeringAgentName(connection)
    const connectedOn = formatConnectedOn(connection.connectedAt)
    // Only a custom install has secrets of its own to replace.
    const canUpdateToken = connection.kind === "custom"
    // Slack throws the whole install away, so a dead Slack app is repaired by installing again.
    const revokedOffersToken = canUpdateToken && !isSlack
    const [conflictChoice, setConflictChoice] = useState<"move" | "own">("move")

    // --- where it answers ------------------------------------------------------ //
    const [spaces, setSpaces] = useState<ChannelSpace[] | null>(null)
    const [spacesError, setSpacesError] = useState<string | null>(null)

    const loadSpaces = useCallback(async () => {
        if (!connectionId) return
        setSpacesError(null)
        let listed: ChannelSpace[]
        try {
            listed = await actions.listSpaces(connectionId)
        } catch (e) {
            setSpaces([])
            setSpacesError(errorMessage(e, `Could not load where ${name} answers.`))
            return
        }
        setSpaces(listed)
        // A place first seen through a message has no stored name; discovery knows it.
        if (!listed.some((space) => space.unnamed)) return
        try {
            const discovered = await actions.discoverSpaces(connectionId)
            setSpaces(nameSpacesFrom(listed, discovered))
        } catch {
            /* keep the stand-in names */
        }
    }, [actions, connectionId, name])

    // --- the picker behind "Add channel" --------------------------------------- //
    const [pickerOpen, setPickerOpen] = useState(false)
    const [candidates, setCandidates] = useState<ChannelSpaceCandidate[] | null>(null)
    const [pickerError, setPickerError] = useState<string | null>(null)
    const [addingName, setAddingName] = useState<string | null>(null)
    // A private channel the bot is not in: only a Slack member can invite it.
    const [inviteFor, setInviteFor] = useState<string | null>(null)

    const openPicker = async () => {
        if (!connectionId) return
        setPickerOpen(true)
        setCandidates(null)
        setPickerError(null)
        setInviteFor(null)
        try {
            setCandidates(await actions.discoverSpaces(connectionId))
        } catch (e) {
            setCandidates([])
            setPickerError(errorMessage(e, "Could not list the channels this app can see."))
        }
    }

    const addCandidate = async (candidate: ChannelSpaceCandidate) => {
        if (!connectionId) return
        setPickerError(null)
        if (candidate.membership === "invite_required") {
            setInviteFor(candidate.displayName)
            return
        }
        setInviteFor(null)
        setAddingName(candidate.displayName)
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
        let writeError: string | null = null
        try {
            await actions.writeBehavior(connection.platform, connectionId, next)
        } catch (e) {
            writeError = errorMessage(e, "Could not save this setting.")
        } finally {
            // Re-read partial writes, but do not erase the failed-save feedback.
            await loadBehavior()
            if (writeError) setBehaviorError(writeError)
            setBehaviorSaving(null)
        }
    }

    // --- who may message the bot (Telegram) ------------------------------------ //
    const [allowed, setAllowed] = useState<string[] | null>(null)
    // "Specific people" with nobody added yet is only local: an empty list means everyone.
    const [restrictDraft, setRestrictDraft] = useState(false)
    const [allowedDraft, setAllowedDraft] = useState("")
    const [allowedSaving, setAllowedSaving] = useState(false)
    const [allowedError, setAllowedError] = useState<string | null>(null)

    const loadAllowed = useCallback(async () => {
        if (!connectionId) return
        setAllowedError(null)
        try {
            setAllowed(await actions.readAllowedUsers(connectionId))
        } catch (e) {
            setAllowed(null)
            setAllowedError(errorMessage(e, "Could not read the allowed accounts."))
        }
    }, [actions, connectionId])

    const writeAllowed = async (ids: string[]) => {
        if (!connectionId) return
        setAllowedSaving(true)
        setAllowedError(null)
        try {
            await actions.writeAllowedUsers(connectionId, ids)
            setAllowed(ids)
            return true
        } catch (e) {
            setAllowedError(errorMessage(e, "Could not save the allowed accounts."))
            return false
        } finally {
            setAllowedSaving(false)
        }
    }

    const restricted = restrictDraft || (allowed?.length ?? 0) > 0

    const addAllowed = async () => {
        const ids = allowedDraft
            .split(",")
            .map((value) => value.trim().replace(/^@/, ""))
            .filter(Boolean)
        if (!ids.length || !allowed) return
        const next = Array.from(new Set([...ids, ...allowed]))
        if (await writeAllowed(next)) setAllowedDraft("")
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
            // A good secret revives the connection; re-read so the revoked banner goes away.
            await actions.reload().catch(() => {
                /* the save landed; a stale status row is not worth an error */
            })
        } catch (e) {
            setTokenError(errorMessage(e, `${name} rejected the new credentials.`))
        } finally {
            setTokenSaving(false)
        }
    }

    // Only the first secret (the token) must be re-entered: the backend keeps a secondary
    // secret left empty, so a token rotation does not force the operator to find it again.
    const tokenValid = (tokenFields ?? []).every(
        (field, index) => index > 0 || !field.required || tokenValues[field.name]?.trim(),
    )

    // Everything below hangs off this agent's channel agent row, which "elsewhere" lacks.
    useEffect(() => {
        if (elsewhere || !connectionId) return
        void loadSpaces()
        void loadBehavior()
        if (isTelegram) void loadAllowed()
    }, [elsewhere, connectionId, isTelegram, loadSpaces, loadBehavior, loadAllowed])

    const run = async (kind: "disconnect" | "connect-here", action: () => Promise<void>) => {
        setBusy(kind)
        setError(null)
        try {
            await action()
        } catch (e) {
            setError({
                kind,
                message: errorMessage(
                    e,
                    kind === "disconnect"
                        ? `Could not disconnect ${name}. Try again.`
                        : `Could not connect ${name} to ${agentName}. Try again.`,
                ),
            })
        } finally {
            setBusy(null)
        }
    }

    const allBehaviorRows: {key: "dm" | "group"; title: string; help: string}[] = [
        {
            key: "dm",
            title: "Direct messages",
            help: isSlack
                ? `Anyone in the workspace can DM ${handle}.`
                : "Private chats people open with the bot.",
        },
        {
            key: "group",
            title: isSlack ? "Channels" : "Group chats",
            help: isSlack
                ? `Replies in a thread when someone mentions ${handle}.`
                : "Groups the bot is added to, when it’s mentioned.",
        },
    ]
    // WhatsApp is one-to-one only: there is no group chat to switch.
    const behaviorRows = isWhatsApp
        ? allBehaviorRows.filter((row) => row.key === "dm")
        : allBehaviorRows

    // Every private chat is its own space, but to the reader they are all "Direct messages".
    const places: ChannelSpace[] | null =
        spaces === null
            ? null
            : [
                  ...(spaces.some((space) => space.kind === "private")
                      ? [{id: "direct-messages", kind: "private" as const, name: "Direct messages"}]
                      : []),
                  ...spaces.filter((space) => space.kind !== "private"),
              ]
    // A place a behavior switch turned off stays listed, marked off.
    const placeOff = (kind: ChannelSpaceKind): boolean =>
        behavior !== null && (kind === "private" ? !behavior.dm : !behavior.group)

    const {title} = connectionRowText(connection, hostedHandle)
    const telegramUrl =
        isTelegram && connection.handle
            ? `https://t.me/${connection.handle.replace(/^@/, "")}`
            : null

    const tokenForm = tokenOpen ? (
        <div
            className="flex flex-col gap-3 rounded-lg border border-solid border-border p-3"
            data-testid="channels-token-form"
        >
            {tokenError ? <Alert type="error" showIcon message={tokenError} /> : null}
            {tokenFields ? (
                tokenFields.map((field, index) => (
                    <label key={field.name} className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-foreground">
                            {field.label}
                        </span>
                        {index > 0 ? (
                            <span className="text-xs text-muted-foreground">
                                Leave empty to keep the current one.
                            </span>
                        ) : null}
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
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
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

    // --- answering as another agent: move it here, or get a bot of its own ------------- //
    if (elsewhere) {
        const ownThing = isSlack ? "a Slack app" : isWhatsApp ? "a WhatsApp number" : "a bot"
        const canOwn = !!onUseOwnBot
        const choice = canOwn ? conflictChoice : "move"
        return (
            <div
                className="flex min-h-full flex-1 flex-col gap-5.5"
                data-testid="channels-connect-here"
            >
                <div className="flex gap-3 rounded-lg bg-colorWarningBg p-3.5">
                    <ArrowsLeftRight size={18} className="mt-px flex-none text-muted-foreground" />
                    <div className="flex min-w-0 flex-col gap-[3px]">
                        <span className="text-sm font-medium text-foreground">
                            {unassigned
                                ? `${title} is connected, but answers as no agent yet`
                                : `${title} is answering as ${otherAgent}`}
                        </span>
                        <span className="text-[13px] text-muted-foreground">
                            {unassigned
                                ? `Connect it here so ${agentName} answers.`
                                : `A connection answers as one agent at a time. The linked chats stay linked.`}
                        </span>
                    </div>
                </div>
                {error?.kind === "connect-here" ? (
                    <Alert type="error" showIcon message={error.message} />
                ) : null}
                {canOwn ? (
                    <div className="flex flex-col gap-2">
                        <span className="text-[13px] font-semibold text-foreground">
                            How should {agentName} connect?
                        </span>
                        <RadioGroup
                            value={choice}
                            onValueChange={(value) => setConflictChoice(value as "move" | "own")}
                            className="gap-0 overflow-hidden rounded-lg border border-solid border-border"
                            data-testid="channels-own-bot-offer"
                        >
                            {[
                                {
                                    value: "move",
                                    title: unassigned ? "Connect it here" : "Move it here",
                                    desc: unassigned
                                        ? `${agentName} answers on ${title}.`
                                        : `${otherAgent} stops answering on ${title}. Linked chats stay linked.`,
                                },
                                {
                                    value: "own",
                                    title: isSlack
                                        ? "Use your own app"
                                        : isWhatsApp
                                          ? "Connect another number"
                                          : "Use your own bot",
                                    desc: unassigned
                                        ? `${agentName} gets ${ownThing} of its own.`
                                        : `${otherAgent} keeps ${title}. ${agentName} gets ${ownThing} of its own.`,
                                },
                            ].map((option, i) => (
                                <label
                                    key={option.value}
                                    className={`flex cursor-pointer gap-3 px-3.5 py-3 ${
                                        i ? "border-0 border-t border-solid border-border" : ""
                                    } ${choice === option.value ? "bg-muted" : "bg-background"}`}
                                >
                                    <RadioGroupItem value={option.value} className="mt-0.5" />
                                    <span className="flex flex-col gap-0.5">
                                        <span className="text-sm font-medium text-foreground">
                                            {option.title}
                                        </span>
                                        <span className="text-[13px] text-muted-foreground">
                                            {option.desc}
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </RadioGroup>
                    </div>
                ) : null}
                <PanelFooter>
                    <Button
                        size="lg"
                        className="w-full"
                        disabled={busy !== null}
                        onClick={() => {
                            if (choice === "own") onUseOwnBot?.()
                            else void run("connect-here", onConnectHere)
                        }}
                    >
                        {busy === "connect-here" ? <Spinner size="small" /> : null}
                        {choice === "own"
                            ? "Continue"
                            : unassigned
                              ? `Connect ${agentName}`
                              : "Move it here"}
                    </Button>
                </PanelFooter>
            </div>
        )
    }

    return (
        <div className="flex min-h-full flex-1 flex-col gap-6.5">
            {/* --- what is connected --- */}
            <div className="flex items-center gap-3 border-0 border-b border-solid border-border pb-5">
                <span className="relative box-border flex size-10 flex-none items-center justify-center rounded-lg border border-solid border-border">
                    {platformLogo(connection.platform, 24)}
                    <span
                        className={`absolute -right-0.5 -top-0.5 size-2 rounded-full border-[1.5px] border-solid border-background ${
                            revoked ? "bg-colorError" : "bg-colorSuccess"
                        }`}
                    />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold text-foreground">
                        {title}
                    </span>
                    <span className="truncate text-[13px] text-muted-foreground">
                        <span className={revoked ? "text-error" : "text-colorSuccess"}>
                            {revoked ? "Not answering" : "Live"}
                        </span>
                        {` · ${connectionKindLabel(connection)}`}
                        {isSlack && connection.handle ? ` · ${connection.handle}` : ""}
                        {connectedOn ? ` · since ${connectedOn}` : ""}
                    </span>
                </div>
                {telegramUrl ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        asChild
                        title="Open in Telegram"
                        aria-label="Open in Telegram"
                    >
                        <a href={telegramUrl} target="_blank" rel="noreferrer">
                            <ArrowSquareOut />
                        </a>
                    </Button>
                ) : null}
            </div>

            {revoked ? (
                <div
                    className="flex items-start gap-2.5 rounded-lg border border-solid border-colorErrorBorder bg-colorErrorBg p-3"
                    data-testid="channels-revoked"
                >
                    <Warning size={16} className="mt-0.5 flex-none text-error" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-foreground">
                            {isWhatsApp
                                ? "Meta rejected the access token"
                                : revokedOffersToken
                                  ? "Telegram revoked the bot token"
                                  : `${name} uninstalled the app`}
                        </span>
                        <span className="text-[13px] text-muted-foreground">
                            {isWhatsApp
                                ? `${agentName} cannot answer there until you paste a new access token.`
                                : revokedOffersToken
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

            {revoked && tokenOpen ? tokenForm : null}

            {/* --- the two switches --- */}
            <div className="flex flex-col">
                <span className={SECTION_TITLE}>Answers in</span>
                {behaviorError ? <Alert type="error" showIcon message={behaviorError} /> : null}
                {behaviorRows.map((row) => (
                    <div key={row.key} className={`flex items-start gap-4 ${ROW}`}>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-sm text-foreground">{row.title}</span>
                            <span className="text-[13px] text-muted-foreground">{row.help}</span>
                        </span>
                        {behaviorSaving === row.key ? <Spinner size="small" /> : null}
                        <Switch
                            size="sm"
                            checked={behavior?.[row.key] ?? true}
                            disabled={behavior === null || behaviorSaving !== null}
                            onCheckedChange={(value) => void toggleBehavior(row.key, value)}
                            aria-label={row.title}
                            data-testid={`channels-behavior-${row.key}`}
                        />
                    </div>
                ))}

                {/* --- where it answers --- */}
                <div className="flex flex-col pt-5">
                    <div className="flex items-center justify-between pb-1">
                        <span className="text-[13px] font-semibold text-foreground">
                            {isSlack ? "Channels it’s in" : isWhatsApp ? "Chats" : "Groups"}
                        </span>
                        {isSlack && !pickerOpen ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => void openPicker()}
                                data-testid="channels-add-space"
                            >
                                <Plus weight="bold" data-icon="inline-start" />
                                Add channel
                            </Button>
                        ) : null}
                    </div>
                    {spacesError ? <Alert type="error" showIcon message={spacesError} /> : null}
                    {places === null ? (
                        <div
                            className={`flex items-center gap-2 text-[13px] text-muted-foreground ${ROW}`}
                        >
                            <Spinner size="small" /> Loading…
                        </div>
                    ) : (
                        places.map((space) => (
                            <div
                                key={space.id}
                                className={`flex items-center gap-2.5 ${ROW}`}
                                data-testid="channels-space"
                            >
                                <span className="flex flex-none text-muted-foreground">
                                    {spaceIcon(space.kind, isSlack)}
                                </span>
                                <span
                                    className={`flex-1 truncate text-sm ${
                                        placeOff(space.kind)
                                            ? "text-muted-foreground"
                                            : "text-foreground"
                                    }`}
                                >
                                    {space.name}
                                </span>
                                <span className="flex-none text-[13px] text-muted-foreground">
                                    {placeOff(space.kind)
                                        ? "Off"
                                        : space.kind === "private"
                                          ? ""
                                          : "Mentions only"}
                                </span>
                            </div>
                        ))
                    )}

                    {pickerOpen ? (
                        <div
                            className="mt-3 flex flex-col gap-2 rounded-lg bg-muted p-3"
                            data-testid="channels-space-picker"
                        >
                            <span className="text-[13px] text-muted-foreground">
                                Pick a channel. The app joins public channels itself. For a private
                                channel, run /invite {inviteHandle} in it first.
                            </span>
                            {pickerError ? (
                                <Alert type="error" showIcon message={pickerError} />
                            ) : null}
                            {inviteFor ? (
                                <Alert
                                    type="info"
                                    showIcon
                                    message={`#${inviteFor.replace(/^#/, "")} is private. Run /invite ${inviteHandle} in it in Slack, then add it again.`}
                                    data-testid="channels-space-invite-hint"
                                />
                            ) : null}
                            {candidates === null ? (
                                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                                    <Spinner size="small" /> Looking…
                                </div>
                            ) : candidates.filter((c) => !c.isConfigured).length === 0 ? (
                                <span className="text-[13px] text-muted-foreground">
                                    No new channels.
                                </span>
                            ) : (
                                <div className="flex flex-col gap-1.5">
                                    {candidates
                                        .filter((candidate) => !candidate.isConfigured)
                                        .map((candidate) => (
                                            <Button
                                                key={`${candidate.kind}-${candidate.displayName}`}
                                                variant="outline"
                                                disabled={addingName !== null}
                                                onClick={() => void addCandidate(candidate)}
                                                className={`${ROW_BUTTON} gap-2.5 px-2.5 py-2`}
                                            >
                                                <span className="flex flex-none text-muted-foreground">
                                                    {spaceIcon(candidate.kind, isSlack)}
                                                </span>
                                                <span className="flex-1 truncate text-[13px] text-foreground">
                                                    {candidate.displayName}
                                                </span>
                                                {candidate.membership === "member" ? (
                                                    <span className="flex-none text-xs text-muted-foreground">
                                                        In channel
                                                    </span>
                                                ) : null}
                                                {addingName === candidate.displayName ? (
                                                    <Spinner size="small" />
                                                ) : null}
                                            </Button>
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

                    {isWhatsApp ? null : (
                        <span className="py-3 text-[13px] text-muted-foreground">
                            {isSlack
                                ? `Invite ${inviteHandle} to a channel to add it here.`
                                : `Add ${handle} to a group and mention it once. The group appears here.`}
                        </span>
                    )}
                </div>
            </div>

            {/* --- where Meta delivers messages (WhatsApp only) --- */}
            {isWhatsApp ? (
                <div className="flex flex-col gap-2">
                    <span className={SECTION_TITLE}>Webhook</span>
                    <WhatsAppWebhook connection={connection} />
                </div>
            ) : null}

            {/* --- who may message it, and its credentials --- */}
            {isTelegram || canUpdateToken ? (
                <div className="flex flex-col">
                    <span className={SECTION_TITLE}>Access</span>
                    {!isTelegram ? null : (
                        <>
                            <div className={`flex items-center gap-4 ${ROW}`}>
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="text-sm text-foreground">
                                        Who can message it
                                    </span>
                                    <span className="text-[13px] text-muted-foreground">
                                        {allowed === null
                                            ? allowedError
                                                ? "Unavailable"
                                                : "Loading…"
                                            : !restricted
                                              ? "Any Telegram account can message the bot."
                                              : allowed.length
                                                ? `Only ${allowed.length} ${allowed.length === 1 ? "account" : "accounts"}. Everyone else is ignored.`
                                                : "Add at least one account below."}
                                    </span>
                                </span>
                                {allowedSaving ? <Spinner size="small" /> : null}
                                <Select
                                    value={restricted ? "specific" : "everyone"}
                                    disabled={allowed === null || allowedSaving}
                                    onValueChange={async (value) => {
                                        if (value === "specific") {
                                            setRestrictDraft(true)
                                            return
                                        }
                                        setRestrictDraft(false)
                                        if (allowed?.length) await writeAllowed([])
                                    }}
                                >
                                    <SelectTrigger
                                        size="sm"
                                        className="w-[150px]"
                                        data-testid="channels-allowed-mode"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="everyone">Everyone</SelectItem>
                                        <SelectItem value="specific">Specific people</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {allowedError ? (
                                <div className="flex items-center gap-2 pt-3">
                                    <Alert
                                        type="error"
                                        showIcon
                                        message={allowedError}
                                        className="flex-1"
                                    />
                                    {allowed === null ? (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void loadAllowed()}
                                        >
                                            Try again
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                            {restricted && allowed !== null ? (
                                <>
                                    <div className={`flex flex-col gap-1.5 ${ROW}`}>
                                        <div className="flex gap-2">
                                            <Input
                                                value={allowedDraft}
                                                onChange={(e) => setAllowedDraft(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") void addAllowed()
                                                }}
                                                placeholder="Telegram user ID"
                                                className="min-w-0 flex-1 font-mono text-xs"
                                                data-testid="channels-allowed-input"
                                            />
                                            <Button
                                                variant="outline"
                                                disabled={!allowedDraft.trim() || allowedSaving}
                                                onClick={() => void addAllowed()}
                                                data-testid="channels-allowed-save"
                                            >
                                                Add
                                            </Button>
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            Numeric IDs, from @userinfobot. Separate several with
                                            commas.
                                        </span>
                                    </div>
                                    {allowed.map((id) => (
                                        <div
                                            key={id}
                                            className="flex items-center gap-2.5 border-0 border-b border-solid border-border py-2.5"
                                            data-testid="channels-allowed-user"
                                        >
                                            <span className="box-border flex size-6 flex-none items-center justify-center rounded-md border border-solid border-border bg-muted text-muted-foreground">
                                                <UsersThree size={12} />
                                            </span>
                                            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
                                                {id}
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                title="Remove"
                                                aria-label={`Remove ${id}`}
                                                disabled={allowedSaving}
                                                onClick={() => {
                                                    const next = allowed.filter((x) => x !== id)
                                                    // Removing the last one keeps "Specific people" open.
                                                    if (!next.length) setRestrictDraft(true)
                                                    void writeAllowed(next)
                                                }}
                                            >
                                                <X />
                                            </Button>
                                        </div>
                                    ))}
                                </>
                            ) : null}
                        </>
                    )}
                    {canUpdateToken ? (
                        <div className={`flex items-center gap-4 ${ROW}`}>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-sm text-foreground">
                                    {isSlack
                                        ? "App credentials"
                                        : isWhatsApp
                                          ? "Access token"
                                          : "Bot token"}
                                </span>
                                <span className="tracking-widest text-[13px] text-muted-foreground">
                                    ••••••••••••
                                </span>
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void openTokenForm()}
                                data-testid="channels-update-token"
                            >
                                Update
                            </Button>
                        </div>
                    ) : null}
                    {!revoked && tokenOpen ? <div className="pt-3">{tokenForm}</div> : null}
                    {tokenSaved ? (
                        <div className="pt-3">
                            <Alert
                                type="success"
                                showIcon
                                message="The new credentials were saved."
                            />
                        </div>
                    ) : null}
                </div>
            ) : null}

            {onAdd ? (
                <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-muted-foreground">
                        {isSlack
                            ? "Add another workspace, or your own Slack app"
                            : isWhatsApp
                              ? "Add another number"
                              : connection.kind === "hosted"
                                ? "Add a bot of your own too"
                                : "Add another bot"}
                    </span>
                    <Button variant="outline" size="sm" onClick={onAdd}>
                        Add
                    </Button>
                </div>
            ) : null}

            {connectionId ? (
                <ChannelAdvancedSection
                    platform={connection.platform}
                    connectionId={connectionId}
                    actions={actions}
                />
            ) : null}

            <PanelFooter>
                {error?.kind === "disconnect" ? (
                    <Alert type="error" showIcon message={error.message} />
                ) : null}
                {confirming ? (
                    <div className="flex flex-col gap-2.5">
                        <span className="text-[13px] text-foreground">
                            Disconnect {disconnectSubject(connection)}? {agentName} stops answering
                            there. Past conversations stay in Agenta.
                        </span>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                disabled={busy !== null}
                                onClick={() => setConfirming(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
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
                    <div className="flex items-center justify-between">
                        <span className="whitespace-nowrap text-[12.5px] text-muted-foreground">
                            Saved automatically
                        </span>
                        <Button
                            variant="destructive"
                            disabled={busy !== null}
                            onClick={() => setConfirming(true)}
                            data-testid="channels-disconnect"
                        >
                            Disconnect
                        </Button>
                    </div>
                )}
            </PanelFooter>
        </div>
    )
}
