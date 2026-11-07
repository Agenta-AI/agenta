import {useCallback, useEffect, useState} from "react"

import {useT, createT} from "@agenta/i18n"
import channelsActionsCatalog from "@agenta/i18n/catalogs/channels.actions"
import channelsLabelsCatalog from "@agenta/i18n/catalogs/channels.labels"
import channelsManageCatalog from "@agenta/i18n/catalogs/channels.manage"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {
    Alert,
    Button,
    Checkbox,
    Input,
    PasswordInput,
    RadioGroup,
    RadioGroupItem,
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
} from "@phosphor-icons/react"

import {nameSpacesFrom} from "./actions"
import {ChannelAdvancedSection} from "./ChannelAdvancedSection"
import {ChannelPeopleSection} from "./ChannelPeopleSection"
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
import {channelSharingCopy} from "./sharingCopy"
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

const tNow = createT(
    channelsActionsCatalog,
    channelsLabelsCatalog,
    channelsManageCatalog,
    commonCatalog,
)

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
    /** Turn the binding that answers here back on. */
    onTurnOn?: () => Promise<void>
}

/** The secret fields a token update asks for when the backend declares none. */
const fallbackSecrets = (platform: ChannelPlatform): ChannelSetupField[] =>
    ({
        telegram: [
            {
                name: "bot_token",
                label: tNow("channels.manage.botToken"),
                secret: true,
                required: true,
            },
        ],
        whatsapp: [
            {
                name: "access_token",
                label: tNow("channels.manage.accessToken"),
                secret: true,
                required: true,
            },
            {
                name: "app_secret",
                label: tNow("channels.manage.appSecret"),
                secret: true,
                required: true,
            },
        ],
        slack: [
            {
                name: "bot_token",
                label: tNow("channels.manage.botUserOAuthToken"),
                secret: true,
                required: true,
            },
            {
                name: "signing_secret",
                label: tNow("channels.manage.signingSecret"),
                secret: true,
                required: true,
            },
        ],
    })[platform]

/** A discovered place's stable identity: its kind and platform address. */
const candidateKey = (candidate: ChannelSpaceCandidate): string =>
    `${candidate.kind}:${JSON.stringify(candidate.externalLocator)}`

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
    onTurnOn,
}: ChannelManagePanelProps) => {
    const t = useT(
        channelsActionsCatalog,
        channelsLabelsCatalog,
        channelsManageCatalog,
        commonCatalog,
    )
    const isSlack = connection.platform === "slack"
    const isTelegram = connection.platform === "telegram"
    const isWhatsApp = connection.platform === "whatsapp"
    const name = platformLabel(connection.platform)
    const connectionId = connection.connectionId
    const handle = botHandle(connection, hostedHandle)
    const inviteHandle = slackInviteHandle(connection)

    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState<"disconnect" | "connect-here" | "turn-on" | null>(null)
    // Which action failed decides where its message shows: next to the button that ran it.
    const [error, setError] = useState<{
        kind: "disconnect" | "connect-here" | "turn-on"
        message: string
    } | null>(null)

    const revoked = connection.status === "revoked"
    const scope = connectionScope(connection, agentId)
    const unassigned = scope === "unassigned"
    const elsewhere = scope === "elsewhere" || unassigned
    // "Who can message it" limits this agent's binding; the panel of another agent's
    // connection ("elsewhere") has no binding of this agent to limit.
    const hasPeople = (isSlack || isTelegram) && !elsewhere
    const otherAgent = unassigned ? t("channels.manage.noAgent") : answeringAgentName(connection)
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
            setSpacesError(errorMessage(e, t("channels.manage.loadSpacesFailed", {platform: name})))
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
    }, [actions, connectionId, name, t])

    // --- the picker behind "Add channel" --------------------------------------- //
    const [pickerOpen, setPickerOpen] = useState(false)
    const [candidates, setCandidates] = useState<ChannelSpaceCandidate[] | null>(null)
    const [pickerError, setPickerError] = useState<string | null>(null)
    const [pickerQuery, setPickerQuery] = useState("")
    // The candidates checked to add, by key, so a reloaded list keeps them checked.
    const [picked, setPicked] = useState<string[]>([])
    const [adding, setAdding] = useState(false)

    const openPicker = async () => {
        if (!connectionId) return
        setPickerOpen(true)
        setCandidates(null)
        setPickerError(null)
        setPickerQuery("")
        setPicked([])
        try {
            setCandidates(await actions.discoverSpaces(connectionId))
        } catch (e) {
            setCandidates([])
            setPickerError(errorMessage(e, t("channels.actions.discoverSpacesFailed")))
        }
    }

    const togglePicked = (candidate: ChannelSpaceCandidate, checked: boolean) => {
        const key = candidateKey(candidate)
        setPicked((current) =>
            checked
                ? current.includes(key)
                    ? current
                    : [...current, key]
                : current.filter((k) => k !== key),
        )
    }

    const addPicked = async () => {
        const chosen = (candidates ?? []).filter((c) => picked.includes(candidateKey(c)))
        if (!connectionId || !chosen.length) return
        setPickerError(null)
        setAdding(true)
        const failed: string[] = []
        let firstError: unknown = null
        for (const candidate of chosen) {
            try {
                await actions.addSpace(connectionId, candidate)
            } catch (e) {
                failed.push(candidateKey(candidate))
                firstError = firstError ?? e
            }
        }
        setAdding(false)
        await loadSpaces()
        if (failed.length) {
            // Keep the ones that failed checked, so a retry adds only those.
            setPicked(failed)
            setPickerError(errorMessage(firstError, t("channels.actions.addSpaceFailed")))
            try {
                setCandidates(await actions.discoverSpaces(connectionId))
            } catch {
                /* keep the list as it was */
            }
            return
        }
        setPickerOpen(false)
    }

    // --- the two behavior switches --------------------------------------------- //
    const [behavior, setBehavior] = useState<ChannelBehaviorState | null>(null)
    // One save of where it answers at a time: the switches and the Advanced row write the
    // same rule set, so each control is off while any of them saves.
    const [behaviorSaving, setBehaviorSaving] = useState<"dm" | "group" | "channels" | null>(null)
    const [behaviorError, setBehaviorError] = useState<string | null>(null)

    const loadBehavior = useCallback(async () => {
        if (!connectionId) return
        setBehaviorError(null)
        try {
            setBehavior(await actions.readBehavior(connection.platform, connectionId))
        } catch (e) {
            setBehavior(null)
            setBehaviorError(errorMessage(e, t("channels.actions.readBehaviorFailed")))
        }
    }, [actions, connectionId, connection.platform, t])

    const toggleBehavior = async (key: "dm" | "group", value: boolean) => {
        if (!connectionId || !behavior || behaviorSaving !== null) return
        const next = {...behavior, [key]: value}
        setBehavior(next)
        setBehaviorSaving(key)
        setBehaviorError(null)
        let writeError: string | null = null
        try {
            await actions.writeBehavior(connection.platform, connectionId, next)
        } catch (e) {
            writeError = errorMessage(e, t("channels.actions.saveSettingFailed"))
        } finally {
            // Re-read partial writes, but do not erase the failed-save feedback.
            await loadBehavior()
            if (writeError) setBehaviorError(writeError)
            setBehaviorSaving(null)
        }
    }

    /** The Advanced "Channels it answers in" row: the switches and the row write one rule set. */
    const saveChannels = async (channels: string[] | null) => {
        if (!connectionId || !behavior || behaviorSaving !== null) return
        const next = {...behavior, spaceIds: channels}
        setBehaviorSaving("channels")
        let writeError: unknown = null
        try {
            await actions.writeBehavior(connection.platform, connectionId, next)
        } catch (e) {
            writeError = e
        } finally {
            await loadBehavior()
            setBehaviorSaving(null)
        }
        if (writeError) throw writeError
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
            setTokenFields(secrets.length ? secrets : fallbackSecrets(connection.platform))
        } catch {
            setTokenFields(fallbackSecrets(connection.platform))
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
            setTokenError(
                errorMessage(e, t("channels.manage.credentialsRejected", {platform: name})),
            )
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
    }, [elsewhere, connectionId, loadSpaces, loadBehavior])

    const run = async (
        kind: "disconnect" | "connect-here" | "turn-on",
        action: () => Promise<void>,
    ) => {
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
                        ? t("channels.manage.disconnectFailed", {platform: name})
                        : kind === "turn-on"
                          ? t("channels.manage.turnOnFailed", {platform: name})
                          : t("channels.manage.connectHereFailed", {
                                platform: name,
                                agent: agentName,
                            }),
                ),
            })
        } finally {
            setBusy(null)
        }
    }

    const allBehaviorRows: {key: "dm" | "group"; title: string; help: string}[] = [
        {
            key: "dm",
            title: t("channels.labels.directMessages"),
            help: isSlack
                ? t("channels.manage.dmHelpSlack", {handle})
                : t("channels.manage.dmHelp"),
        },
        {
            key: "group",
            title: isSlack ? t("channels.manage.channels") : t("channels.manage.groupChats"),
            help: isSlack
                ? t("channels.manage.groupHelpSlack", {handle})
                : t("channels.manage.groupHelp"),
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
                      ? [
                            {
                                id: "direct-messages",
                                kind: "private" as const,
                                name: t("channels.labels.directMessages"),
                            },
                        ]
                      : []),
                  ...spaces.filter((space) => space.kind !== "private"),
              ]
    // A place a behavior switch turned off stays listed, marked off; so does a channel left
    // unchecked under "Only these channels".
    const placeOff = (space: ChannelSpace): boolean => {
        if (behavior === null) return false
        if (space.kind === "private") return !behavior.dm
        if (!behavior.group) return true
        return behavior.spaceIds !== null && !behavior.spaceIds.includes(space.id)
    }

    const {title} = connectionRowText(connection, hostedHandle)
    // The binding is off: nothing answers until it is turned on.
    const off = !!connection.agentOff
    // One row per connection; the channels it sits in are listed inside it.
    const offPlaces = (spaces ?? [])
        .filter((space) => space.kind !== "private")
        .map((space) =>
            isSlack && space.kind === "topic" && !space.name.startsWith("#")
                ? `#${space.name}`
                : space.name,
        )
    // The off row needs a host that can turn the binding on (one that wires agent sharing).
    const offBlock =
        off && onTurnOn ? (
            <div className="flex flex-col gap-3" data-testid="channels-off">
                <div className="flex items-center gap-3 px-1">
                    <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-muted">
                        {platformLogo(connection.platform, 16)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="truncate text-sm font-medium text-foreground">
                            {channelSharingCopy.connectionRow(
                                name,
                                (isSlack ? connection.workspaceName : null) || handle,
                            )}
                        </span>
                        <span className="text-[12.5px] text-muted-foreground">
                            {offPlaces.length
                                ? channelSharingCopy.offIn(offPlaces)
                                : channelSharingCopy.off}
                        </span>
                    </span>
                    <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void run("turn-on", onTurnOn)}
                        data-testid="channels-turn-on"
                    >
                        {busy === "turn-on" ? <Spinner size="small" /> : null}
                        {channelSharingCopy.turnOn}
                    </Button>
                </div>
                {error?.kind === "turn-on" ? (
                    <Alert type="error" showIcon message={error.message} />
                ) : null}
            </div>
        ) : null
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
                                {t("channels.manage.leaveEmpty")}
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
                    <Spinner size="small" /> {t("channels.manage.loadingSetup", {platform: name})}
                </div>
            )}
            <div className="flex justify-end gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={tokenSaving}
                    onClick={() => setTokenOpen(false)}
                >
                    {t("common.cancel")}
                </Button>
                <Button
                    size="sm"
                    disabled={!tokenFields || !tokenValid || tokenSaving}
                    onClick={() => void saveToken()}
                    data-testid="channels-token-save"
                >
                    {tokenSaving ? <Spinner size="small" /> : null}
                    {t("common.save")}
                </Button>
            </div>
        </div>
    ) : null

    // --- answering as another agent: move it here, or get a bot of its own ------------- //
    if (elsewhere) {
        const canOwn = !!onUseOwnBot
        const choice = canOwn ? conflictChoice : "move"
        return (
            <div
                className="flex min-h-full flex-1 flex-col gap-[22px]"
                data-testid="channels-connect-here"
            >
                <div className="flex gap-3 rounded-lg bg-colorWarningBg p-3.5">
                    <ArrowsLeftRight size={18} className="mt-px flex-none text-muted-foreground" />
                    <div className="flex min-w-0 flex-col gap-[3px]">
                        <span className="text-sm font-medium text-foreground">
                            {unassigned
                                ? t("channels.manage.unassignedTitle", {title})
                                : t("channels.manage.elsewhereTitle", {
                                      title,
                                      agent: otherAgent,
                                  })}
                        </span>
                        <span className="text-[13px] text-muted-foreground">
                            {unassigned
                                ? t("channels.manage.unassignedHelp", {agent: agentName})
                                : t("channels.manage.elsewhereHelp")}
                        </span>
                    </div>
                </div>
                {error?.kind === "connect-here" ? (
                    <Alert type="error" showIcon message={error.message} />
                ) : null}
                {canOwn ? (
                    <div className="flex flex-col gap-2">
                        <span className="text-[13px] font-semibold text-foreground">
                            {t("channels.manage.howConnect", {agent: agentName})}
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
                                    title: unassigned
                                        ? t("channels.manage.connectItHere")
                                        : t("channels.manage.moveItHere"),
                                    desc: unassigned
                                        ? t("channels.manage.moveDescUnassigned", {
                                              agent: agentName,
                                              title,
                                          })
                                        : t("channels.manage.moveDesc", {
                                              other: otherAgent,
                                              title,
                                          }),
                                },
                                {
                                    value: "own",
                                    title: isSlack
                                        ? t("channels.manage.useOwnApp")
                                        : isWhatsApp
                                          ? t("channels.manage.connectAnotherNumber")
                                          : t("channels.manage.useOwnBot"),
                                    desc: unassigned
                                        ? t(
                                              isSlack
                                                  ? "channels.manage.ownDescSlack"
                                                  : isWhatsApp
                                                    ? "channels.manage.ownDescWhatsApp"
                                                    : "channels.manage.ownDescBot",
                                              {agent: agentName},
                                          )
                                        : t(
                                              isSlack
                                                  ? "channels.manage.keepDescSlack"
                                                  : isWhatsApp
                                                    ? "channels.manage.keepDescWhatsApp"
                                                    : "channels.manage.keepDescBot",
                                              {other: otherAgent, title, agent: agentName},
                                          ),
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
                        disabled={busy !== null}
                        onClick={() => {
                            if (choice === "own") onUseOwnBot?.()
                            else void run("connect-here", onConnectHere)
                        }}
                    >
                        {busy === "connect-here" ? <Spinner size="small" /> : null}
                        {choice === "own"
                            ? t("common.continue")
                            : unassigned
                              ? t("channels.manage.connectAgent", {agent: agentName})
                              : t("channels.manage.moveItHere")}
                    </Button>
                </PanelFooter>
            </div>
        )
    }

    return (
        <div className="flex min-h-full flex-1 flex-col gap-[26px]">
            {/* --- what is connected --- */}
            <div className="flex items-center gap-3 border-0 border-b border-solid border-border pb-5">
                <span className="relative box-border flex size-10 flex-none items-center justify-center rounded-lg border border-solid border-border">
                    {platformLogo(connection.platform, 24)}
                    <span
                        className={`absolute -right-0.5 -top-0.5 size-2 rounded-full border-[1.5px] border-solid border-background ${
                            revoked
                                ? "bg-colorError"
                                : off
                                  ? "bg-colorTextQuaternary"
                                  : "bg-colorSuccess"
                        }`}
                    />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold text-foreground">
                        {title}
                    </span>
                    <span className="truncate text-[13px] text-muted-foreground">
                        <span
                            className={
                                revoked
                                    ? "text-error"
                                    : off
                                      ? "text-muted-foreground"
                                      : "text-colorSuccess"
                            }
                        >
                            {revoked
                                ? t("channels.manage.notAnswering")
                                : off
                                  ? channelSharingCopy.off
                                  : t("common.live")}
                        </span>
                        {` · ${connectionKindLabel(connection)}`}
                        {isSlack && connection.handle ? ` · ${connection.handle}` : ""}
                        {connectedOn ? ` · ${t("channels.manage.since", {date: connectedOn})}` : ""}
                    </span>
                </div>
                {telegramUrl ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        asChild
                        title={t("channels.manage.openInTelegram")}
                        aria-label={t("channels.manage.openInTelegram")}
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
                                ? t("channels.manage.metaRejectedToken")
                                : revokedOffersToken
                                  ? t("channels.manage.telegramRevokedToken")
                                  : t("channels.manage.appUninstalled", {platform: name})}
                        </span>
                        <span className="text-[13px] text-muted-foreground">
                            {isWhatsApp
                                ? t("channels.manage.revokedHelpWhatsApp", {
                                      agent: agentName,
                                  })
                                : revokedOffersToken
                                  ? t("channels.manage.revokedHelpTelegram", {
                                        agent: agentName,
                                    })
                                  : t("channels.manage.revokedHelpApp", {
                                        agent: agentName,
                                    })}
                        </span>
                        {revokedOffersToken ? (
                            tokenOpen ? null : (
                                <div>
                                    <Button size="sm" onClick={() => void openTokenForm()}>
                                        {t("channels.manage.updateToken")}
                                    </Button>
                                </div>
                            )
                        ) : onReconnect ? (
                            <div>
                                <Button size="sm" onClick={onReconnect}>
                                    {t("common.reconnect")}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {revoked && tokenOpen ? tokenForm : null}

            {offBlock}

            {/* --- the two switches --- */}
            <div className="flex flex-col">
                <span className={SECTION_TITLE}>{t("channels.manage.answersIn")}</span>
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
                            {isSlack
                                ? t("channels.manage.channelsItsIn")
                                : isWhatsApp
                                  ? t("channels.manage.chats")
                                  : t("channels.manage.groups")}
                        </span>
                        {isSlack && !pickerOpen ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => void openPicker()}
                                data-testid="channels-add-space"
                            >
                                <Plus weight="bold" data-icon="inline-start" />
                                {t("channels.manage.addChannel")}
                            </Button>
                        ) : null}
                    </div>
                    {spacesError ? <Alert type="error" showIcon message={spacesError} /> : null}
                    {places === null ? (
                        <div
                            className={`flex items-center gap-2 text-[13px] text-muted-foreground ${ROW}`}
                        >
                            <Spinner size="small" /> {t("channels.labels.loading")}
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
                                        placeOff(space)
                                            ? "text-muted-foreground"
                                            : "text-foreground"
                                    }`}
                                >
                                    {space.name}
                                </span>
                                <span className="flex-none text-[13px] text-muted-foreground">
                                    {placeOff(space)
                                        ? t("channels.manage.off")
                                        : space.kind === "private"
                                          ? ""
                                          : t("channels.manage.mentionsOnly")}
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
                                {t("channels.manage.pickerHint", {handle: inviteHandle})}
                            </span>
                            {pickerError ? (
                                <Alert type="error" showIcon message={pickerError} />
                            ) : null}
                            <Input
                                value={pickerQuery}
                                onChange={(e) => setPickerQuery(e.target.value)}
                                placeholder={t("channels.manage.searchChannels")}
                                className="text-[13px]"
                                data-testid="channels-space-search"
                            />
                            {(() => {
                                if (candidates === null)
                                    return (
                                        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                                            <Spinner size="small" /> {t("channels.labels.looking")}
                                        </div>
                                    )
                                const fresh = candidates.filter((c) => !c.isConfigured)
                                const query = pickerQuery.trim().toLowerCase().replace(/^#/, "")
                                const shown = query
                                    ? fresh.filter((c) =>
                                          c.displayName
                                              .toLowerCase()
                                              .replace(/^#/, "")
                                              .includes(query),
                                      )
                                    : fresh
                                if (!shown.length)
                                    return (
                                        <span className="text-[13px] text-muted-foreground">
                                            {query
                                                ? t("channels.manage.noChannelMatches", {
                                                      query: pickerQuery.trim(),
                                                  })
                                                : t("channels.manage.noNewChannels")}
                                        </span>
                                    )
                                return (
                                    <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                                        {shown.map((candidate) => {
                                            // A private channel the bot is not in: only a Slack
                                            // member can invite it.
                                            const blocked =
                                                candidate.membership === "invite_required"
                                            return (
                                                <label
                                                    key={`${candidate.kind}-${candidate.displayName}`}
                                                    className={`${ROW_BUTTON} flex items-center gap-2.5 rounded-md border border-solid border-border bg-background px-2.5 py-2 ${
                                                        blocked
                                                            ? "cursor-not-allowed opacity-70"
                                                            : "cursor-pointer"
                                                    }`}
                                                    data-testid="channels-space-candidate"
                                                >
                                                    <Checkbox
                                                        checked={picked.includes(
                                                            candidateKey(candidate),
                                                        )}
                                                        disabled={blocked || adding}
                                                        onCheckedChange={(value) =>
                                                            togglePicked(candidate, value === true)
                                                        }
                                                        aria-label={candidate.displayName}
                                                    />
                                                    <span className="flex flex-none text-muted-foreground">
                                                        {spaceIcon(candidate.kind, isSlack)}
                                                    </span>
                                                    <span className="flex-1 truncate text-[13px] text-foreground">
                                                        {candidate.displayName}
                                                    </span>
                                                    {blocked ? (
                                                        <span className="flex-none text-xs text-muted-foreground">
                                                            {t("channels.manage.runInviteFirst")}
                                                        </span>
                                                    ) : candidate.membership === "member" ? (
                                                        <span className="flex-none text-xs text-muted-foreground">
                                                            {t("channels.manage.inChannel")}
                                                        </span>
                                                    ) : null}
                                                </label>
                                            )
                                        })}
                                    </div>
                                )
                            })()}
                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={adding}
                                    onClick={() => setPickerOpen(false)}
                                >
                                    {t("common.cancel")}
                                </Button>
                                <Button
                                    size="sm"
                                    disabled={adding || !picked.length}
                                    onClick={() => void addPicked()}
                                    data-testid="channels-space-add"
                                >
                                    {adding ? <Spinner size="small" /> : null}
                                    {picked.length > 1
                                        ? t("channels.manage.addChannels", {
                                              count: picked.length,
                                          })
                                        : t("channels.manage.addChannel")}
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    {isWhatsApp || places?.length !== 0 ? null : (
                        <span className="py-3 text-[13px] text-muted-foreground">
                            {isSlack
                                ? t("channels.manage.emptySlack", {handle: inviteHandle})
                                : t("channels.manage.emptyGroups", {handle})}
                        </span>
                    )}
                </div>
            </div>

            {/* --- where Meta delivers messages (WhatsApp only) --- */}
            {isWhatsApp ? (
                <div className="flex flex-col gap-2">
                    <span className={SECTION_TITLE}>{t("channels.manage.webhook")}</span>
                    <WhatsAppWebhook connection={connection} />
                </div>
            ) : null}

            {/* --- who may message it, and its credentials --- */}
            {hasPeople || canUpdateToken ? (
                <div className="flex flex-col">
                    <span className={SECTION_TITLE}>{t("channels.manage.access")}</span>
                    {hasPeople && connectionId ? (
                        <ChannelPeopleSection
                            platform={connection.platform}
                            connectionId={connectionId}
                            actions={actions}
                            handle={handle}
                            workspaceName={connection.workspaceName}
                        />
                    ) : null}
                    {canUpdateToken ? (
                        <div className={`flex items-center gap-4 ${ROW}`}>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-sm text-foreground">
                                    {isSlack
                                        ? t("channels.manage.appCredentials")
                                        : isWhatsApp
                                          ? t("channels.manage.accessToken")
                                          : t("channels.manage.botToken")}
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
                                {t("common.update")}
                            </Button>
                        </div>
                    ) : null}
                    {!revoked && tokenOpen ? <div className="pt-3">{tokenForm}</div> : null}
                    {tokenSaved ? (
                        <div className="pt-3">
                            <Alert
                                type="success"
                                showIcon
                                message={t("channels.manage.credentialsSaved")}
                            />
                        </div>
                    ) : null}
                </div>
            ) : null}

            {onAdd ? (
                <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-muted-foreground">
                        {isSlack
                            ? t("channels.manage.addAnotherWorkspace")
                            : isWhatsApp
                              ? t("channels.manage.addAnotherNumber")
                              : connection.kind === "hosted"
                                ? t("channels.manage.addOwnBotToo")
                                : t("channels.manage.addAnotherBot")}
                    </span>
                    <Button variant="outline" size="sm" onClick={onAdd}>
                        {t("common.add")}
                    </Button>
                </div>
            ) : null}

            {connectionId ? (
                <ChannelAdvancedSection
                    platform={connection.platform}
                    connectionId={connectionId}
                    actions={actions}
                    answersIn={
                        isWhatsApp || elsewhere || (isTelegram && connection.kind === "hosted")
                            ? undefined
                            : {
                                  behavior,
                                  channels: (spaces ?? []).filter(
                                      (space) => space.kind !== "private",
                                  ),
                                  onSave: saveChannels,
                                  busy: behaviorSaving !== null,
                              }
                    }
                />
            ) : null}

            <PanelFooter>
                {error?.kind === "disconnect" ? (
                    <Alert type="error" showIcon message={error.message} className="w-full" />
                ) : null}
                {confirming ? (
                    <div className="flex w-full flex-col gap-2.5">
                        <span className="text-[13px] text-foreground">
                            {t("channels.manage.disconnectConfirm", {
                                subject: disconnectSubject(connection),
                                agent: agentName,
                            })}
                        </span>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                disabled={busy !== null}
                                onClick={() => setConfirming(false)}
                            >
                                {t("common.cancel")}
                            </Button>
                            <Button
                                variant="destructive"
                                disabled={busy !== null}
                                onClick={() => void run("disconnect", onDisconnect)}
                                data-testid="channels-disconnect-confirm"
                            >
                                {busy === "disconnect" ? <Spinner size="small" /> : null}
                                {t("common.disconnect")}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex w-full items-center justify-end">
                        <Button
                            variant="destructive"
                            disabled={busy !== null}
                            onClick={() => setConfirming(true)}
                            data-testid="channels-disconnect"
                        >
                            {t("common.disconnect")}
                        </Button>
                    </div>
                )}
            </PanelFooter>
        </div>
    )
}
