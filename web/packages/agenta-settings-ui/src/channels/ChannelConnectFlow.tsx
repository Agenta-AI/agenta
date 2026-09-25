import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    Alert,
    Button,
    Input,
    InputAffix,
    PasswordInput,
    RadioGroup,
    RadioGroupItem,
    Spinner,
    Textarea,
} from "@agenta/ui/ui"
import {
    ArrowLeft,
    ArrowSquareOut,
    ArrowsClockwise,
    At,
    ChatsCircle,
    Check,
    CheckCircle,
    Clock,
    DownloadSimple,
    Eye,
    FileText,
    Lightning,
    Link,
    Plug,
    Wrench,
} from "@phosphor-icons/react"

import {CodeBlock} from "./CodeBlock"
import {
    NOOP_ACTIONS,
    SLACK_APP_DESCRIPTION_MAX,
    SLACK_APP_NAME_MAX,
    SLACK_BOT_HANDLE_MAX,
    defaultSlackIdentity,
    errorMessage,
    fieldPatternError,
    platformLabel,
    slackHandleFrom,
} from "./helpers"
import {platformLogo} from "./icons"
import {PanelFooter} from "./PanelFooter"
import {QrCode} from "./qr"
import type {
    ChannelConnection,
    ChannelInstallMode,
    ChannelPlatform,
    ChannelSetupField,
    ChannelSetupInfo,
    ChannelsActions,
    HostedTelegramLink,
} from "./types"
import {ViewTransition} from "./ViewTransition"
import {WhatsAppWebhook, copyText} from "./WhatsAppWebhook"

/**
 * The connect flow for one platform, shared by the desktop drawer and the /m sheet.
 *
 * Hosted Telegram: mint the one-time link, show it as a QR code and a button, then wait for
 * the /start in Telegram to bind the chat (polled through `actions`). Hosted Slack: open the
 * install redirect in a new window and wait for a new connection to appear. Custom app/bot:
 * render the fields the backend declares, create the connection, point it at this agent.
 */

export interface ChannelConnectFlowProps {
    platform: ChannelPlatform
    agentName: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    workspaceName?: string
    /** The hosted bot/app handle to show, e.g. "@newagentabot". */
    hostedHandle?: string
    actions?: ChannelsActions
    /** Which method the flow opens on. "custom" is how an agent gets a bot of its own. */
    initialMode?: ChannelInstallMode
    /** Connected connection ids before this attempt; the hosted Slack wait looks for a new one. */
    knownConnectionIds?: string[]
    /** This agent already answers through the Agenta bot, so that method is off. */
    hostedConnectedHere?: boolean
    /** The agent already has a connection on this platform; this one adds to it. */
    adding?: boolean
    /** Called once a connection is confirmed; the host reloads and shows manage. */
    onConnected: () => Promise<void> | void
    /** Polling cadence for the hosted waits, ms. Exposed for tests and stories. */
    pollIntervalMs?: number
}

/** Where a self-hosted deployment learns to run the Agenta Telegram bot itself. */
const TELEGRAM_HOSTED_DOCS = "https://docs.agenta.ai/self-host/channels/telegram-hosted-bot"

type SlackCustomStep = "choose" | "name" | "guide" | "creds"
const SCREEN_ORDER: SlackCustomStep[] = ["choose", "name", "guide", "creds"]
type SlackAppChoice = "new" | "existing"
type TelegramHostedStep = "preparing" | "qr" | "waiting" | "linked" | "expired" | "unavailable"

/** Example values for declared setup fields; the backend sends none. */
const FIELD_PLACEHOLDERS: Partial<Record<ChannelPlatform, Record<string, string>>> = {
    telegram: {bot_token: "123456789:AAH…"},
}

/** How long the hosted Slack install wait runs before giving up, ms. */
const SLACK_INSTALL_TIMEOUT_MS = 5 * 60 * 1000

const SECTION_TITLE = "text-[13px] font-semibold text-foreground"

const META_APPS_URL = "https://developers.facebook.com/apps"
const WHATSAPP_PRICING_URL =
    "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing"

/** A step's number in a small square: filled for the current step, outlined for the rest. */
const StepNumber = ({index, state}: {index: number; state: "current" | "done" | "upcoming"}) => (
    <span
        className={`flex size-5 flex-none items-center justify-center rounded-[5px] text-[11px] font-semibold ${
            state === "upcoming"
                ? "border border-solid border-border bg-background text-muted-foreground"
                : "bg-primary text-primary-foreground"
        }`}
    >
        {state === "done" ? <Check size={10} weight="bold" /> : index}
    </span>
)

const StepRow = ({
    index,
    total,
    active,
    title,
    body,
    children,
}: {
    index: number
    total: number
    /** The step the user is on; its number is filled. */
    active: boolean
    title: string
    body?: React.ReactNode
    children?: React.ReactNode
}) => {
    const last = index === total
    return (
        <div className="flex gap-3">
            <div className="flex flex-none flex-col items-center">
                <StepNumber index={index} state={active ? "current" : "upcoming"} />
                {last ? null : <span className="mt-2 w-px flex-1 bg-border" aria-hidden="true" />}
            </div>
            <div className={`flex min-w-0 flex-1 flex-col gap-2.5 ${last ? "" : "pb-6"}`}>
                <div className="flex flex-col gap-1">
                    <span className="pt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Step {index}
                    </span>
                    <span className="text-sm font-medium text-foreground">{title}</span>
                    {body ? (
                        <span className="text-[13px] text-muted-foreground">{body}</span>
                    ) : null}
                </div>
                {children}
            </div>
        </div>
    )
}

/** An inline command, e.g. /newbot. */
const Command = ({children}: {children: React.ReactNode}) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
        {children}
    </code>
)

interface MethodOption<T extends string> {
    value: T
    title: string
    desc: string
    icon: React.ReactNode
    recommended?: boolean
    disabled?: boolean
}

const MethodCards = <T extends string>({
    options,
    value,
    onChange,
    testId,
}: {
    options: MethodOption<T>[]
    value: T
    onChange: (value: T) => void
    testId?: string
}) => (
    <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as T)}
        className="gap-2"
        data-testid={testId}
    >
        {options.map((option) => {
            const selected = option.value === value
            return (
                <label
                    key={option.value}
                    className={`flex items-center gap-3 rounded-lg border border-solid bg-background px-3 py-2.5 transition-[border-color,box-shadow] ${
                        option.disabled ? "cursor-default opacity-70" : "cursor-pointer"
                    } ${selected ? "border-foreground shadow-md" : "border-border shadow-xs"}`}
                >
                    <span className="flex size-[30px] flex-none items-center justify-center rounded-lg bg-muted text-foreground">
                        {option.icon}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                            {option.title}
                            {option.recommended ? (
                                <span className="rounded-full bg-colorSuccessBg px-[7px] text-[11px] font-medium leading-[18px] text-colorSuccess">
                                    Recommended
                                </span>
                            ) : null}
                        </span>
                        <span
                            className="truncate text-[12.5px] text-muted-foreground"
                            title={option.desc}
                        >
                            {option.desc}
                        </span>
                    </span>
                    <RadioGroupItem
                        value={option.value}
                        disabled={option.disabled}
                        data-testid={`${testId}-${option.value}`}
                    />
                </label>
            )
        })}
    </RadioGroup>
)

const StepsBar = ({steps, current}: {steps: string[]; current: number}) => (
    <ol className="m-0 flex list-none items-center gap-2 p-0" data-testid="channels-steps">
        {steps.map((step, i) => (
            <li
                key={step}
                className={`flex min-w-0 items-center gap-2 ${
                    i < steps.length - 1 ? "flex-1" : "flex-none"
                }`}
            >
                <StepNumber
                    index={i + 1}
                    state={i < current ? "done" : i === current ? "current" : "upcoming"}
                />
                <span
                    className={`truncate text-sm ${
                        i === current ? "font-medium text-foreground" : "text-muted-foreground"
                    }`}
                >
                    {step}
                </span>
                {i < steps.length - 1 ? (
                    <span className="h-px min-w-3 flex-1 bg-border" aria-hidden="true" />
                ) : null}
            </li>
        ))}
    </ol>
)

/** Draws the QR code's svg onto a white canvas and saves it as a PNG. */
const downloadQrPng = (svg: SVGSVGElement | null, filename: string) => {
    if (!svg) return
    const source = new XMLSerializer().serializeToString(svg)
    const image = new Image()
    image.onload = () => {
        const size = 480
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext("2d")
        if (!context) return
        context.fillStyle = "#fff"
        context.fillRect(0, 0, size, size)
        context.drawImage(image, 0, 0, size, size)
        const link = document.createElement("a")
        link.href = canvas.toDataURL("image/png")
        link.download = filename
        link.click()
    }
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
}

const formatCountdown = (ms: number) => {
    const seconds = Math.max(0, Math.round(ms / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export const ChannelConnectFlow = ({
    platform,
    agentName,
    agentDescription,
    hostedHandle = "@agenta",
    actions = NOOP_ACTIONS,
    initialMode = "hosted",
    knownConnectionIds = [],
    hostedConnectedHere = false,
    adding = false,
    onConnected,
    pollIntervalMs = 2500,
}: ChannelConnectFlowProps) => {
    const isSlack = platform === "slack"
    const isTelegram = platform === "telegram"
    // WhatsApp has no Agenta-hosted number: the customer always brings their own.
    const isWhatsApp = platform === "whatsapp"
    const name = platformLabel(platform)

    const [mode, setMode] = useState<ChannelInstallMode>(
        isWhatsApp || hostedConnectedHere ? "custom" : initialMode,
    )
    // A new WhatsApp connection, held on screen until its webhook values are copied into Meta.
    const [whatsAppConnection, setWhatsAppConnection] = useState<ChannelConnection | null>(null)
    const [error, setError] = useState<string | null>(null)

    // --- custom app/bot: the declared setup ---------------------------------- //
    const [setup, setSetup] = useState<ChannelSetupInfo | null>(null)
    const [setupLoading, setSetupLoading] = useState(false)
    const [values, setValues] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState(false)
    const [slackStep, setSlackStep] = useState<SlackCustomStep>("choose")
    const [slackApp, setSlackApp] = useState<SlackAppChoice>("new")

    // --- custom Slack app: how it presents itself --------------------------- //
    const [slackIdentity, setSlackIdentity] = useState(() =>
        defaultSlackIdentity(agentName, agentDescription),
    )
    // The handle follows the name until the user edits it by hand.
    const [handleEdited, setHandleEdited] = useState(false)
    // Kept apart from `setup`, whose first load (no identity) may land after this one.
    const [namedManifest, setNamedManifest] = useState<string | null>(null)
    const [manifestLoading, setManifestLoading] = useState(false)

    // --- hosted Slack ---------------------------------------------------------- //
    const [authorizing, setAuthorizing] = useState(false)
    const [slackInstallUrl, setSlackInstallUrl] = useState<string | null>(null)

    // --- hosted Telegram ------------------------------------------------------- //
    const [tgStep, setTgStep] = useState<TelegramHostedStep>("preparing")
    const [tgLink, setTgLink] = useState<HostedTelegramLink | null>(null)
    const [tgBaseline, setTgBaseline] = useState(0)
    // The link's expiry, fixed once at mint: going back to the QR does not extend it.
    const [tgExpiresAt, setTgExpiresAt] = useState(0)
    const [now, setNow] = useState(() => Date.now())
    const [linkCopied, setLinkCopied] = useState(false)
    const qrRef = useRef<HTMLDivElement>(null)
    // The minted deep link names the real bot (t.me/<bot>?start=…); prefer it to the default.
    const telegramHandle = useMemo(() => {
        if (!tgLink) return hostedHandle
        try {
            const bot = new URL(tgLink.url).pathname.replace(/^\/+/, "")
            return bot ? `@${bot}` : hostedHandle
        } catch {
            return hostedHandle
        }
    }, [tgLink, hostedHandle])

    const alive = useRef(true)
    // The error sits above a form taller than the panel, while the button that failed is at
    // its bottom: bring the error into view, or it goes unseen.
    const errorRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (error) errorRef.current?.scrollIntoView?.({block: "nearest", behavior: "smooth"})
    }, [error])
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    // The polls below call the latest `onConnected` without restarting on every render.
    const onConnectedRef = useRef(onConnected)
    onConnectedRef.current = onConnected
    const knownRef = useRef(knownConnectionIds)
    const lastScreen = useRef<SlackCustomStep>("choose")
    const screenDirection = useRef(1)
    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
            clearTimeout(timer.current)
            clearTimeout(feedbackTimer.current)
        }
    }, [])

    const later = (fn: () => void, ms: number) => {
        clearTimeout(timer.current)
        timer.current = setTimeout(fn, ms)
    }

    const feedbackLater = (fn: () => void, ms: number) => {
        clearTimeout(feedbackTimer.current)
        feedbackTimer.current = setTimeout(fn, ms)
    }

    // Load the declared fields the first time the custom mode opens; the guard is a ref so
    // the effect does not cancel its own request.
    const setupRequested = useRef(false)
    // Bumped by "Try again": WhatsApp has no method switch to re-run the load.
    const [setupAttempt, setSetupAttempt] = useState(0)
    useEffect(() => {
        if (mode !== "custom" || setupRequested.current) return
        setupRequested.current = true
        let cancelled = false
        setSetupLoading(true)
        actions
            .loadSetup(platform)
            .then((info) => {
                if (!cancelled) setSetup(info)
            })
            .catch((e) => {
                if (cancelled) return
                setupRequested.current = false // let a retry (mode switch) load again
                setError(errorMessage(e, `Could not load the ${name} setup.`))
            })
            .finally(() => {
                if (!cancelled) setSetupLoading(false)
            })
        return () => {
            cancelled = true
            // The response is discarded, so the next visit must load again.
            setupRequested.current = false
        }
    }, [mode, actions, platform, name, setupAttempt])

    // --- hosted Telegram: mint, then wait for the /start ---------------------- //
    const mintingTelegramLink = useRef(false)
    const mintTelegramLink = useCallback(async () => {
        if (mintingTelegramLink.current) return
        mintingTelegramLink.current = true
        setTgStep("preparing")
        setError(null)
        try {
            const link = await actions.connectHostedTelegram()
            const baseline = await actions
                .countHostedTelegramBindings(link.connectionId)
                .catch(() => 0)
            if (!alive.current) return
            setTgLink(link)
            setTgExpiresAt(Date.now() + link.expiresInSeconds * 1000)
            setTgBaseline(baseline)
            setTgStep("qr")
        } catch (e) {
            if (!alive.current) return
            setTgLink(null)
            setTgStep("unavailable")
            setError(
                errorMessage(
                    e,
                    "The hosted Telegram bot is not available on this deployment. Use your own bot instead.",
                ),
            )
        } finally {
            mintingTelegramLink.current = false
        }
    }, [actions])

    useEffect(() => {
        if (!isTelegram || mode !== "hosted" || tgLink || tgStep !== "preparing") return
        void mintTelegramLink()
    }, [isTelegram, mode, tgLink, tgStep, mintTelegramLink])

    // Poll the bindings while the link is on screen: a scan from a phone never clicks the button.
    useEffect(() => {
        if (
            !isTelegram ||
            mode !== "hosted" ||
            (tgStep !== "waiting" && tgStep !== "qr") ||
            !tgLink
        )
            return
        let cancelled = false
        const deadline = tgExpiresAt
        const tick = async () => {
            if (cancelled) return
            try {
                const count = await actions.countHostedTelegramBindings(tgLink.connectionId)
                if (cancelled) return
                if (count > tgBaseline) {
                    setTgStep("linked")
                    await onConnectedRef.current()
                    return
                }
            } catch {
                /* a failed poll is retried on the next tick */
            }
            if (Date.now() > deadline) {
                setTgStep("expired")
                return
            }
            later(tick, pollIntervalMs)
        }
        later(tick, pollIntervalMs)
        return () => {
            cancelled = true
            clearTimeout(timer.current)
        }
    }, [isTelegram, mode, tgStep, tgLink, tgBaseline, tgExpiresAt, actions, pollIntervalMs])

    // The countdown under the QR code.
    useEffect(() => {
        if (tgStep !== "qr" && tgStep !== "waiting") return
        const interval = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(interval)
    }, [tgStep])

    // --- hosted Slack: open the install, then wait for the connection --------- //
    const startSlackInstall = async () => {
        setError(null)
        setAuthorizing(true)
        let url: string | null = null
        try {
            url = await actions.hostedSlackInstallUrl()
        } catch (e) {
            if (!alive.current) return
            setAuthorizing(false)
            setError(errorMessage(e, "Could not start the Slack install."))
            return
        }
        if (!alive.current) return
        if (!url) {
            setAuthorizing(false)
            setError("This deployment has no hosted Slack app. Connect your own app instead.")
            return
        }
        // Opened after an await: a popup blocker may hold it, so the link also shows while waiting.
        setSlackInstallUrl(url)
        window.open(url, "_blank", "noopener")
    }

    useEffect(() => {
        if (!isSlack || mode !== "hosted" || !authorizing || !slackInstallUrl) return
        let cancelled = false
        const deadline = Date.now() + SLACK_INSTALL_TIMEOUT_MS
        const tick = async () => {
            if (cancelled) return
            try {
                const connections = await actions.reload()
                if (cancelled) return
                const rows: (ChannelConnection | null)[] = connections.allConnections ?? [
                    connections.slack,
                ]
                // Only a connection that was not live before this attempt is the new install.
                const installed = rows.find(
                    (c) =>
                        c?.platform === "slack" &&
                        c.connectionId &&
                        c.kind === "hosted" &&
                        c.status === "connected" &&
                        !knownRef.current.includes(c.connectionId),
                )
                if (installed?.connectionId) {
                    await actions.connectHere("slack", installed.connectionId)
                    await actions.reload()
                    if (cancelled) return
                    setAuthorizing(false)
                    await onConnectedRef.current()
                    return
                }
            } catch (e) {
                if (cancelled) return
                setAuthorizing(false)
                setError(errorMessage(e, "Slack didn’t finish the install."))
                return
            }
            if (Date.now() > deadline) {
                setAuthorizing(false)
                setError(
                    "Slack didn’t finish the install. The authorization window was closed or Slack returned an error. Nothing was saved — try again.",
                )
                return
            }
            later(tick, pollIntervalMs)
        }
        later(tick, pollIntervalMs)
        return () => {
            cancelled = true
            clearTimeout(timer.current)
        }
    }, [isSlack, mode, authorizing, slackInstallUrl, actions, pollIntervalMs])

    // --- custom Slack: build the manifest for the chosen identity -------------- //
    const identityValid = Boolean(slackIdentity.name.trim() && slackIdentity.handle)

    const buildNamedManifest = async () => {
        setError(null)
        setManifestLoading(true)
        try {
            const info = await actions.loadSetup(platform, {
                name: slackIdentity.name.trim(),
                handle: slackIdentity.handle,
                description: slackIdentity.description.trim() || undefined,
            })
            if (!alive.current) return
            setNamedManifest(info.manifest)
            setSlackStep("guide")
        } catch (e) {
            if (!alive.current) return
            setError(errorMessage(e, `Could not load the ${name} setup.`))
        } finally {
            if (alive.current) setManifestLoading(false)
        }
    }

    // --- custom: submit the declared fields ----------------------------------- //
    const fields: ChannelSetupField[] = setup?.fields ?? []
    const fieldsValid = fields.every(
        (field) =>
            (!field.required || values[field.name]?.trim()) &&
            !fieldPatternError(field, values[field.name] ?? ""),
    )

    const submitCustom = async () => {
        setSaving(true)
        setError(null)
        try {
            const created = await actions.connectCustom(platform, values)
            if (!alive.current) return
            if (isWhatsApp && created?.webhookUrl && created.webhookVerifyToken) {
                setWhatsAppConnection(created)
            } else await onConnected()
        } catch (e) {
            if (!alive.current) return
            setError(errorMessage(e, `${name} rejected the credentials.`))
        } finally {
            if (alive.current) setSaving(false)
        }
    }

    const changeMode = (next: ChannelInstallMode) => {
        clearTimeout(timer.current)
        setMode(next)
        setError(null)
        setAuthorizing(false)
        setSaving(false)
    }

    const methodOptions: MethodOption<ChannelInstallMode>[] = isSlack
        ? [
              {
                  value: "hosted",
                  title: "Agenta app",
                  desc: `One click. Shows up as ${hostedHandle}.`,
                  icon: <Lightning size={15} />,
                  recommended: true,
              },
              {
                  value: "custom",
                  title: "Your own app",
                  desc: "Your name and avatar. About 5 min.",
                  icon: <Wrench size={15} />,
              },
          ]
        : [
              {
                  value: "hosted",
                  title: "Agenta bot",
                  desc: hostedConnectedHere
                      ? `Already connected as ${hostedHandle}.`
                      : "Scan a code and start chatting.",
                  icon: hostedConnectedHere ? <CheckCircle size={15} /> : <Lightning size={15} />,
                  recommended: !hostedConnectedHere,
                  disabled: hostedConnectedHere,
              },
              {
                  value: "custom",
                  title: "Your own bot",
                  desc: "Created with @BotFather.",
                  icon: <Wrench size={15} />,
              },
          ]

    // The token step becomes the current one once the user starts filling it in.
    const tokenEntered = fields.some((field) => values[field.name]?.trim())

    // A step whose title already names the field hides the field's own label.
    const renderFields = (hideLabels = false) => (
        <div className="flex flex-col gap-4">
            {setupLoading ? (
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Spinner size="small" /> Loading the {name} setup…
                </div>
            ) : null}
            {fields.map((field) => (
                <SetupFieldInput
                    key={field.name}
                    field={field}
                    value={values[field.name] ?? ""}
                    onChange={(value) => setValues((v) => ({...v, [field.name]: value}))}
                    placeholder={FIELD_PLACEHOLDERS[platform]?.[field.name]}
                    hideLabel={hideLabels}
                />
            ))}
        </div>
    )

    const errorAlert = error ? (
        <div ref={errorRef}>
            <Alert
                type="error"
                showIcon
                message={`${name} is not connected`}
                description={error}
                data-testid="channels-connect-error"
            />
        </div>
    ) : null

    // Which screen shows, and which way the user moved, for the side-by-side swap.
    const screen: SlackCustomStep =
        isSlack && mode === "custom" && slackStep !== "choose" ? slackStep : "choose"
    if (lastScreen.current !== screen) {
        screenDirection.current =
            SCREEN_ORDER.indexOf(screen) >= SCREEN_ORDER.indexOf(lastScreen.current) ? 1 : -1
        lastScreen.current = screen
    }

    // --- Slack custom app: the steps after the method choice ---------------------- //
    if (screen !== "choose") {
        const steps = slackApp === "new" ? ["Name", "Create app", "Connect"] : null
        const current = slackStep === "name" ? 0 : slackStep === "guide" ? 1 : 2
        const goBack = () => {
            setError(null)
            if (slackStep === "creds" && slackApp === "new") setSlackStep("guide")
            else if (slackStep === "guide") setSlackStep("name")
            else setSlackStep("choose")
        }
        return (
            <ViewTransition viewKey={screen} direction={screenDirection.current}>
                <div className="flex min-h-full flex-1 flex-col gap-5.5">
                    {steps ? <StepsBar steps={steps} current={current} /> : null}
                    {errorAlert}

                    {slackStep === "name" ? (
                        <div className="flex flex-col gap-4" data-testid="channels-slack-identity">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-semibold text-foreground">
                                    How it shows up in Slack
                                </span>
                                <span className="text-[13px] text-muted-foreground">
                                    People mention it as @{slackIdentity.handle || "handle"}.
                                </span>
                            </div>
                            <IdentityField
                                label="Name"
                                length={slackIdentity.name.length}
                                max={SLACK_APP_NAME_MAX}
                            >
                                <Input
                                    value={slackIdentity.name}
                                    maxLength={SLACK_APP_NAME_MAX}
                                    onChange={(e) => {
                                        const next = e.target.value
                                        setSlackIdentity((current) => ({
                                            ...current,
                                            name: next,
                                            handle: handleEdited
                                                ? current.handle
                                                : slackHandleFrom(next),
                                        }))
                                    }}
                                    data-testid="channels-slack-app-name"
                                />
                            </IdentityField>
                            <IdentityField
                                label="Handle"
                                length={slackIdentity.handle.length}
                                max={SLACK_BOT_HANDLE_MAX}
                                help="Letters, numbers, periods, hyphens and underscores."
                            >
                                <InputAffix
                                    prefix={<At size={14} className="text-muted-foreground" />}
                                    value={slackIdentity.handle}
                                    maxLength={SLACK_BOT_HANDLE_MAX}
                                    onValueChange={(next) => {
                                        setHandleEdited(true)
                                        setSlackIdentity((current) => ({
                                            ...current,
                                            handle: slackHandleFrom(next),
                                        }))
                                    }}
                                    data-testid="channels-slack-app-handle"
                                />
                            </IdentityField>
                            <IdentityField
                                label="Description"
                                length={slackIdentity.description.length}
                                max={SLACK_APP_DESCRIPTION_MAX}
                            >
                                <Textarea
                                    value={slackIdentity.description}
                                    maxLength={SLACK_APP_DESCRIPTION_MAX}
                                    rows={3}
                                    onChange={(e) => {
                                        const next = e.target.value
                                        setSlackIdentity((current) => ({
                                            ...current,
                                            description: next,
                                        }))
                                    }}
                                    data-testid="channels-slack-app-description"
                                />
                            </IdentityField>
                        </div>
                    ) : null}

                    {slackStep === "guide" ? (
                        <div className="flex flex-col gap-3.5">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-semibold text-foreground">
                                    Create the app from a manifest
                                </span>
                                <span className="text-[13px] text-muted-foreground">
                                    In Slack, choose Create New App → From a manifest, pick your
                                    workspace and paste this. Then install the app to your
                                    workspace.
                                </span>
                            </div>
                            {namedManifest ? (
                                <CodeBlock
                                    label={
                                        namedManifest.trimStart().startsWith("{")
                                            ? "manifest.json"
                                            : "manifest.yml"
                                    }
                                    code={namedManifest}
                                    wrap
                                    data-testid="channels-manifest"
                                />
                            ) : (
                                <span className="text-[13px] text-colorWarning">
                                    No manifest is available for this deployment.
                                </span>
                            )}
                            <div>
                                <Button variant="outline" asChild>
                                    <a
                                        href="https://api.slack.com/apps"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        <ArrowSquareOut data-icon="inline-start" />
                                        Open Slack app settings
                                    </a>
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    {slackStep === "creds" ? (
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-semibold text-foreground">
                                    Paste the app&apos;s credentials
                                </span>
                                <span className="text-[13px] text-muted-foreground">
                                    Copy these from the app&apos;s settings in Slack. We check them
                                    with Slack, and they stay masked after saving.
                                </span>
                            </div>
                            {renderFields()}
                        </div>
                    ) : null}

                    <PanelFooter>
                        <div className="flex gap-2">
                            <Button variant="outline" size="lg" onClick={goBack}>
                                <ArrowLeft data-icon="inline-start" />
                                Back
                            </Button>
                            {slackStep === "name" ? (
                                <Button
                                    size="lg"
                                    className="flex-1"
                                    disabled={!identityValid || manifestLoading}
                                    onClick={() => void buildNamedManifest()}
                                    data-testid="channels-slack-identity-next"
                                >
                                    {manifestLoading ? "Preparing…" : "Next"}
                                </Button>
                            ) : slackStep === "guide" ? (
                                <Button
                                    size="lg"
                                    className="flex-1"
                                    onClick={() => setSlackStep("creds")}
                                >
                                    Next
                                </Button>
                            ) : (
                                <Button
                                    size="lg"
                                    className="flex-1"
                                    disabled={!fieldsValid || saving || fields.length === 0}
                                    onClick={() => void submitCustom()}
                                    data-testid="channels-connect-custom"
                                >
                                    {saving ? "Connecting…" : "Connect app"}
                                </Button>
                            )}
                        </div>
                    </PanelFooter>
                </div>
            </ViewTransition>
        )
    }

    // --- the method choice and what each method needs ------------------------------ //
    const expiresIn = tgExpiresAt ? formatCountdown(tgExpiresAt - now) : ""
    const tgShowsCode = tgStep === "qr" || tgStep === "waiting"

    let cta: React.ReactNode = null
    let note: string
    if (isSlack) {
        note = adding
            ? "Your other workspaces stay connected. Each workspace answers as one agent."
            : "One Slack workspace routes to one agent. Direct messages work right away."
        cta =
            mode === "hosted" ? (
                <Button
                    size="lg"
                    className="w-full"
                    disabled={authorizing}
                    onClick={() => void startSlackInstall()}
                    data-testid="channels-add-to-slack"
                >
                    {authorizing ? "Waiting for Slack…" : "Add to Slack"}
                </Button>
            ) : (
                <Button
                    size="lg"
                    className="w-full"
                    onClick={() => setSlackStep(slackApp === "new" ? "name" : "creds")}
                    data-testid="channels-slack-custom-continue"
                >
                    Continue
                </Button>
            )
    } else if (isWhatsApp) {
        note = "Meta bills your business directly for WhatsApp messages."
        cta = whatsAppConnection ? (
            <Button size="lg" className="w-full" onClick={() => void onConnected()}>
                Done
            </Button>
        ) : (
            <Button
                size="lg"
                className="w-full"
                disabled={!fieldsValid || saving || fields.length === 0}
                onClick={() => void submitCustom()}
                data-testid="channels-connect-custom"
            >
                {saving ? "Connecting…" : "Connect to WhatsApp"}
            </Button>
        )
    } else {
        note =
            mode === "hosted"
                ? "Group chats appear here after someone mentions the bot in them once."
                : "Your bot answers only as this agent. Other bots stay connected."
        if (mode === "custom") {
            cta = (
                <Button
                    size="lg"
                    className="w-full"
                    disabled={!fieldsValid || saving || fields.length === 0}
                    onClick={() => void submitCustom()}
                    data-testid="channels-connect-custom"
                >
                    {saving ? "Connecting…" : "Connect bot"}
                </Button>
            )
        } else if (tgShowsCode && tgLink) {
            cta = (
                <Button size="lg" className="w-full" asChild>
                    <a
                        href={tgLink.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setTgStep("waiting")}
                        data-testid="channels-continue-in-telegram"
                    >
                        <ArrowSquareOut data-icon="inline-start" />
                        Open in Telegram
                    </a>
                </Button>
            )
        } else if (tgStep === "expired") {
            cta = (
                <Button size="lg" className="w-full" onClick={() => void mintTelegramLink()}>
                    Get a new link
                </Button>
            )
        } else if (tgStep === "unavailable") {
            cta = (
                <div className="flex gap-2">
                    <Button variant="outline" size="lg" onClick={() => void mintTelegramLink()}>
                        Try again
                    </Button>
                    <Button size="lg" className="flex-1" onClick={() => changeMode("custom")}>
                        Use your own bot
                    </Button>
                </div>
            )
        }
    }

    return (
        <ViewTransition viewKey={screen} direction={screenDirection.current}>
            <div className="flex min-h-full flex-1 flex-col gap-5.5">
                {errorAlert}

                {isWhatsApp ? null : (
                    <div className="flex flex-col gap-2">
                        <span className={SECTION_TITLE}>Connect with</span>
                        <MethodCards
                            options={methodOptions}
                            value={mode}
                            onChange={changeMode}
                            testId="channels-method"
                        />
                        <span
                            className="px-0.5 text-xs text-muted-foreground"
                            data-testid="channels-connect-note"
                        >
                            {note}
                        </span>
                    </div>
                )}

                {/* SLACK · hosted */}
                {isSlack && mode === "hosted" ? (
                    <div className="flex flex-col gap-2">
                        <span className={SECTION_TITLE}>What to expect</span>
                        <div className="flex flex-col">
                            {[
                                {
                                    icon: <Eye size={16} />,
                                    title: "Reads only where it’s added",
                                    body: "Channels you invite it to, plus DMs.",
                                },
                                {
                                    icon: <ChatsCircle size={16} />,
                                    title: "Replies in threads",
                                    body: `Mention ${hostedHandle} in a channel to get an answer from ${agentName}.`,
                                },
                                {
                                    icon: <ArrowsClockwise size={16} />,
                                    title: "Nothing to maintain",
                                    body: "No manifest or secrets. Disconnect any time.",
                                },
                            ].map((fact) => (
                                <div
                                    key={fact.title}
                                    className="flex items-start gap-3 border-0 border-b border-solid border-border py-[11px]"
                                >
                                    <span className="mt-px flex flex-none text-muted-foreground">
                                        {fact.icon}
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                                        <span className="text-sm text-foreground">
                                            {fact.title}
                                        </span>
                                        <span className="text-[13px] text-muted-foreground">
                                            {fact.body}
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                {isSlack && mode === "hosted" && authorizing ? (
                    <div className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <Spinner size="small" /> Finish the install in the Slack window…
                            <Button
                                variant="link"
                                size="xs"
                                onClick={() => {
                                    clearTimeout(timer.current)
                                    setAuthorizing(false)
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                        {slackInstallUrl ? (
                            <a
                                href={slackInstallUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[13px] text-foreground underline underline-offset-2"
                            >
                                Slack didn’t open? Open it here.
                            </a>
                        ) : null}
                    </div>
                ) : null}

                {/* SLACK · custom: a new app, or one already made */}
                {isSlack && mode === "custom" ? (
                    <div className="flex flex-col gap-2">
                        <span className={SECTION_TITLE}>Your app</span>
                        <MethodCards
                            options={[
                                {
                                    value: "new" as const,
                                    title: "New app",
                                    desc: `Start from a manifest we fill in for ${agentName}.`,
                                    icon: <FileText size={15} />,
                                },
                                {
                                    value: "existing" as const,
                                    title: "Existing app",
                                    desc: "Reuse an app you already created in Slack.",
                                    icon: <Plug size={15} />,
                                },
                            ]}
                            value={slackApp}
                            onChange={setSlackApp}
                            testId="channels-slack-app"
                        />
                    </div>
                ) : null}

                {/* TELEGRAM · hosted */}
                {isTelegram && mode === "hosted" ? (
                    <div className="overflow-hidden rounded-2xl border border-solid border-border">
                        <div className="relative flex flex-col items-center gap-[18px] bg-muted bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-[size:14px_14px] px-5 pb-[22px] pt-7">
                            {tgStep === "preparing" ? (
                                <div className="flex h-[200px] items-center justify-center gap-2 text-[13px] text-muted-foreground">
                                    <Spinner size="small" /> Preparing your link…
                                </div>
                            ) : null}
                            {tgShowsCode && tgLink ? (
                                <>
                                    <div className="relative p-3.5">
                                        {(
                                            [
                                                "left-0 top-0 border-l-2 border-t-2 rounded-tl-lg",
                                                "right-0 top-0 border-r-2 border-t-2 rounded-tr-lg",
                                                "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                                                "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                                            ] as const
                                        ).map((corner) => (
                                            <span
                                                key={corner}
                                                className={`absolute size-5 border-0 border-solid border-foreground ${corner}`}
                                            />
                                        ))}
                                        <div
                                            ref={qrRef}
                                            className="relative box-border size-[172px] rounded-xl bg-white p-3.5 text-black shadow-lg"
                                        >
                                            <QrCode
                                                value={tgLink.url}
                                                size={144}
                                                label={`QR code: open ${telegramHandle} in Telegram`}
                                            />
                                            <span className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white">
                                                {platformLogo("telegram", 26)}
                                            </span>
                                        </div>
                                    </div>
                                    <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-solid border-border bg-background px-2.5 text-xs text-muted-foreground">
                                        <Clock size={13} />
                                        Expires in
                                        <span className="font-medium tabular-nums text-foreground">
                                            {expiresIn}
                                        </span>
                                    </span>
                                    <div className="absolute right-3 top-3 flex gap-1.5">
                                        <Button
                                            variant="outline"
                                            size="icon-sm"
                                            title="Download QR code"
                                            aria-label="Download QR code"
                                            onClick={() =>
                                                downloadQrPng(
                                                    qrRef.current?.querySelector("svg") ?? null,
                                                    "telegram-agenta-qr.png",
                                                )
                                            }
                                        >
                                            <DownloadSimple />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="icon-sm"
                                            title={linkCopied ? "Link copied" : "Copy link"}
                                            aria-label="Copy link"
                                            onClick={async () => {
                                                const ok = await copyText(tgLink.url)
                                                setLinkCopied(ok)
                                                feedbackLater(() => setLinkCopied(false), 1800)
                                            }}
                                            data-testid="channels-copy-telegram-link"
                                        >
                                            {linkCopied ? <Check weight="bold" /> : <Link />}
                                        </Button>
                                    </div>
                                </>
                            ) : null}
                            {tgStep === "expired" ? (
                                <div className="flex h-[200px] w-full items-center">
                                    <Alert
                                        type="warning"
                                        showIcon
                                        className="w-full"
                                        message="The link expired"
                                        description="Nothing was linked. Get a new link and open it within the time shown."
                                    />
                                </div>
                            ) : null}
                            {tgStep === "unavailable" ? (
                                <div className="flex h-[200px] items-center">
                                    <a
                                        href={TELEGRAM_HOSTED_DOCS}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-1 text-[13px] text-foreground"
                                    >
                                        Set up the hosted bot on a self-hosted deployment (docs)
                                        <ArrowSquareOut size={12} />
                                    </a>
                                </div>
                            ) : null}
                            {tgStep === "linked" ? (
                                <div
                                    className="flex h-[200px] items-center gap-2 text-[13px] text-foreground"
                                    data-testid="channels-telegram-linked"
                                >
                                    <Check size={14} weight="bold" className="text-colorSuccess" />
                                    Linked. {agentName} answers in that Telegram chat now.
                                </div>
                            ) : null}
                        </div>
                        <div className="flex flex-col gap-1 border-0 border-t border-solid border-border bg-background px-5 py-4 text-center">
                            <span className="text-sm font-semibold text-foreground">
                                Scan with your phone
                            </span>
                            <span className="text-[13px] text-muted-foreground">
                                {telegramHandle} asks you to confirm, then this chat is linked to{" "}
                                {agentName}.
                            </span>
                            {tgStep === "waiting" ? (
                                <div
                                    className="flex flex-col items-center gap-1.5 pt-1.5"
                                    data-testid="channels-telegram-waiting"
                                >
                                    <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                                        <Spinner size="small" /> Waiting for you in Telegram…
                                    </span>
                                    <Button
                                        variant="link"
                                        size="xs"
                                        onClick={() => void onConnected()}
                                    >
                                        I already linked this chat
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {/* TELEGRAM · custom */}
                {isTelegram && mode === "custom" ? (
                    <div className="flex flex-col">
                        <StepRow
                            index={1}
                            total={2}
                            active={!tokenEntered}
                            title="Create a bot with @BotFather"
                            body={
                                <>
                                    Send <Command>/newbot</Command>, then pick a name and a username
                                    ending in “bot”.
                                </>
                            }
                        >
                            <div>
                                <Button variant="outline" size="sm" asChild>
                                    <a
                                        href="https://t.me/BotFather"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        <ArrowSquareOut data-icon="inline-start" />
                                        Open @BotFather
                                    </a>
                                </Button>
                            </div>
                        </StepRow>
                        <StepRow
                            index={2}
                            total={2}
                            active={tokenEntered}
                            title="Paste the bot token"
                            body="We check it with Telegram, then keep it masked."
                        >
                            {renderFields(true)}
                        </StepRow>
                    </div>
                ) : null}

                {/* WHATSAPP · your own number */}
                {isWhatsApp && !whatsAppConnection ? (
                    <div className="flex flex-col gap-5.5">
                        <Alert
                            type="info"
                            showIcon
                            data-testid="channels-connect-note"
                            message={
                                <>
                                    {note}{" "}
                                    <a
                                        href={WHATSAPP_PRICING_URL}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-foreground underline underline-offset-2"
                                    >
                                        WhatsApp pricing
                                    </a>
                                </>
                            }
                        />
                        <div className="flex flex-col">
                            <StepRow
                                index={1}
                                total={3}
                                active={!tokenEntered}
                                title="Create a Meta app with WhatsApp"
                                body="In Meta’s App Dashboard, create a Business app and add the WhatsApp product."
                            >
                                <div>
                                    <Button variant="outline" size="sm" asChild>
                                        <a href={META_APPS_URL} target="_blank" rel="noreferrer">
                                            <ArrowSquareOut data-icon="inline-start" />
                                            Open Meta App Dashboard
                                        </a>
                                    </Button>
                                </div>
                            </StepRow>
                            <StepRow
                                index={2}
                                total={3}
                                active={false}
                                title="Copy three values"
                                body="The phone number ID from WhatsApp > API Setup, a permanent token for a system user from Meta Business Settings, and the app secret from App settings > Basic."
                            />
                            <StepRow
                                index={3}
                                total={3}
                                active={tokenEntered}
                                title="Paste them here"
                                body="We check them with Meta before saving. Secrets stay masked after you save."
                            >
                                {renderFields()}
                                {!setup && !setupLoading ? (
                                    <div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setError(null)
                                                setSetupAttempt((n) => n + 1)
                                            }}
                                        >
                                            Try again
                                        </Button>
                                    </div>
                                ) : null}
                            </StepRow>
                        </div>
                    </div>
                ) : null}

                {isWhatsApp && whatsAppConnection ? (
                    <div className="flex flex-col gap-4">
                        <div
                            className="flex items-center gap-2 rounded-lg bg-colorSuccessBg p-3 text-[13px] text-foreground"
                            data-testid="channels-whatsapp-connected"
                        >
                            <Check size={14} weight="bold" className="text-colorSuccess" />
                            Connected. One step left in Meta.
                        </div>
                        <WhatsAppWebhook connection={whatsAppConnection} />
                    </div>
                ) : null}

                {cta ? <PanelFooter>{cta}</PanelFooter> : null}
            </div>
        </ViewTransition>
    )
}

const IdentityField = ({
    label,
    length,
    max,
    help,
    children,
}: {
    label: string
    length: number
    max: number
    help?: string
    children: React.ReactNode
}) => (
    <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-foreground">{label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
                {length}/{max}
            </span>
        </span>
        {children}
        {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
    </label>
)

const SetupFieldInput = ({
    field,
    value,
    onChange,
    placeholder,
    hideLabel = false,
}: {
    field: ChannelSetupField
    value: string
    onChange: (value: string) => void
    placeholder?: string
    hideLabel?: boolean
}) => {
    const patternError = fieldPatternError(field, value)
    return (
        <label className="flex flex-col gap-1.5" aria-label={hideLabel ? field.label : undefined}>
            {hideLabel ? null : (
                <span className="flex items-baseline justify-between">
                    <span className="text-[13px] font-medium text-foreground">{field.label}</span>
                    {field.required ? (
                        <span className="text-xs text-muted-foreground">Required</span>
                    ) : null}
                </span>
            )}
            {field.secret ? (
                <PasswordInput
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => onChange(e.target.value)}
                    className="font-mono text-xs"
                    data-testid={`channels-field-${field.name}`}
                />
            ) : (
                <Input
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => onChange(e.target.value)}
                    className="font-mono text-xs"
                    data-testid={`channels-field-${field.name}`}
                    aria-invalid={patternError ? true : undefined}
                />
            )}
            {patternError ? (
                <span
                    className="text-xs text-error"
                    data-testid={`channels-field-${field.name}-error`}
                >
                    {patternError}
                </span>
            ) : field.help ? (
                <span className="text-xs text-muted-foreground">{field.help}</span>
            ) : null}
        </label>
    )
}
