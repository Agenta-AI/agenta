import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Alert, Button, Input, PasswordInput, Segmented, Spinner} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretRight, Check, Copy, FileText, Plug} from "@phosphor-icons/react"

import {NOOP_ACTIONS, errorMessage, platformLabel} from "./helpers"
import {AgentaMark, platformLogo} from "./icons"
import {QrCode} from "./qr"
import type {
    ChannelInstallMode,
    ChannelPlatform,
    ChannelSetupField,
    ChannelSetupInfo,
    ChannelsActions,
    HostedTelegramLink,
} from "./types"

/**
 * The connect flow for one platform, shared by the desktop drawer and the /m sheet.
 *
 * Hosted Telegram: mint the one-time link, show it as a QR code and a button, then wait for
 * the /start in Telegram to bind the chat (polled through `actions`). Hosted Slack: open the
 * install redirect in a new window and wait for the connection to appear. Custom app/bot:
 * render the fields the backend declares, create the connection, point it at this agent.
 *
 * Every state the user can reach is real: nothing here simulates a handshake.
 */

export interface ChannelConnectFlowProps {
    platform: ChannelPlatform
    agentName: string
    workspaceName?: string
    /** The hosted bot/app handle to show, e.g. "@newagentabot". */
    hostedHandle?: string
    actions?: ChannelsActions
    /** Called once a connection is confirmed; the host reloads and the panel shows manage. */
    onConnected: () => Promise<void> | void
    /** Polling cadence for the hosted waits, ms. Exposed for tests and stories. */
    pollIntervalMs?: number
}

type SlackCustomStep = "choose" | "guide" | "creds"
type TelegramHostedStep = "preparing" | "qr" | "waiting" | "linked" | "expired" | "unavailable"

const STEP_MARKER =
    "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-colorFillQuaternary text-xs font-medium text-colorText"

/** How long the hosted Slack install wait runs before giving up, ms. */
const SLACK_INSTALL_TIMEOUT_MS = 5 * 60 * 1000

const StepRow = ({
    index,
    title,
    body,
    children,
}: {
    index: number
    title: string
    body?: React.ReactNode
    children?: React.ReactNode
}) => (
    <div className="flex items-start gap-3">
        <span className={STEP_MARKER}>{index}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-colorText">{title}</span>
                {body ? (
                    <p className="m-0 text-xs leading-relaxed text-colorTextSecondary">{body}</p>
                ) : null}
            </div>
            {children}
        </div>
    </div>
)

const copyText = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}

export const ChannelConnectFlow = ({
    platform,
    agentName,
    workspaceName = "your workspace",
    hostedHandle = "@agenta",
    actions = NOOP_ACTIONS,
    onConnected,
    pollIntervalMs = 2500,
}: ChannelConnectFlowProps) => {
    const isSlack = platform === "slack"
    const name = platformLabel(platform)

    const [mode, setMode] = useState<ChannelInstallMode>("hosted")
    const [error, setError] = useState<string | null>(null)

    // --- custom app/bot: the declared setup ---------------------------------- //
    const [setup, setSetup] = useState<ChannelSetupInfo | null>(null)
    const [setupLoading, setSetupLoading] = useState(false)
    const [values, setValues] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState(false)
    const [slackStep, setSlackStep] = useState<SlackCustomStep>("choose")
    const [copied, setCopied] = useState(false)
    const [manifestOpen, setManifestOpen] = useState(false)

    // --- hosted Slack ---------------------------------------------------------- //
    const [authorizing, setAuthorizing] = useState(false)
    const [slackInstallUrl, setSlackInstallUrl] = useState<string | null>(null)

    // --- hosted Telegram ------------------------------------------------------- //
    const [tgStep, setTgStep] = useState<TelegramHostedStep>("preparing")
    const [tgLink, setTgLink] = useState<HostedTelegramLink | null>(null)
    const [tgBaseline, setTgBaseline] = useState(0)
    const [linkCopied, setLinkCopied] = useState(false)
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
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    // The polls below call the latest `onConnected` without restarting on every render.
    const onConnectedRef = useRef(onConnected)
    onConnectedRef.current = onConnected
    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
            clearTimeout(timer.current)
        }
    }, [])

    const later = (fn: () => void, ms: number) => {
        clearTimeout(timer.current)
        timer.current = setTimeout(fn, ms)
    }

    // Load the declared fields (and manifest) the first time the custom mode opens. The
    // in-flight guard is a ref, not state: a state dependency would re-run this effect and
    // cancel the request it had just started.
    const setupRequested = useRef(false)
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
        }
    }, [mode, actions, platform, name])

    // --- hosted Telegram: mint, then wait for the /start ---------------------- //
    const mintTelegramLink = useCallback(async () => {
        setTgStep("preparing")
        setError(null)
        try {
            const link = await actions.connectHostedTelegram()
            const baseline = await actions
                .countHostedTelegramBindings(link.connectionId)
                .catch(() => 0)
            if (!alive.current) return
            setTgLink(link)
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
        }
    }, [actions])

    useEffect(() => {
        if (isSlack || mode !== "hosted" || tgLink || tgStep !== "preparing") return
        void mintTelegramLink()
    }, [isSlack, mode, tgLink, tgStep, mintTelegramLink])

    // Poll the bindings while waiting; a new binding means the /start completed.
    useEffect(() => {
        if (tgStep !== "waiting" || !tgLink) return
        let cancelled = false
        const deadline = Date.now() + tgLink.expiresInSeconds * 1000
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
    }, [tgStep, tgLink, tgBaseline, actions, pollIntervalMs])

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
            setError("This deployment has no hosted Slack app. Connect a custom app instead.")
            return
        }
        // Opened after an await: a popup blocker may hold it, so the link is also
        // shown under the button while waiting.
        setSlackInstallUrl(url)
        window.open(url, "_blank", "noopener")
    }

    useEffect(() => {
        if (!authorizing || !slackInstallUrl) return
        let cancelled = false
        const deadline = Date.now() + SLACK_INSTALL_TIMEOUT_MS
        const tick = async () => {
            if (cancelled) return
            try {
                const connections = await actions.reload()
                const slack = connections.slack
                if (slack?.connectionId) {
                    // The install created the connection; point it at this agent. This runs
                    // even if the reload above already switched the page to the manage view
                    // and unmounted this flow: the retarget is idempotent, and skipping it
                    // would leave a connection that answers as no agent.
                    await actions.connectHere("slack", slack.connectionId)
                    await actions.reload()
                    if (cancelled) return
                    setAuthorizing(false)
                    await onConnectedRef.current()
                    return
                }
                if (cancelled) return
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
    }, [authorizing, slackInstallUrl, actions, pollIntervalMs])

    // --- custom: submit the declared fields ----------------------------------- //
    const fields: ChannelSetupField[] = setup?.fields ?? []
    const fieldsValid = fields.every((field) => !field.required || values[field.name]?.trim())

    const submitCustom = async () => {
        setSaving(true)
        setError(null)
        try {
            await actions.connectCustom(platform, values)
            await onConnected()
        } catch (e) {
            if (!alive.current) return
            setError(errorMessage(e, `${name} rejected the credentials.`))
        } finally {
            if (alive.current) setSaving(false)
        }
    }

    const modeOptions = useMemo(
        () =>
            isSlack
                ? [
                      {label: "Agenta app", value: "hosted"},
                      {label: "Custom app", value: "custom"},
                  ]
                : [
                      {label: "Agenta bot", value: "hosted"},
                      {label: "Your own bot", value: "custom"},
                  ],
        [isSlack],
    )

    const fieldsForm = (
        <>
            {setupLoading ? (
                <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                    <Spinner size="small" /> Loading the {name} setup…
                </div>
            ) : null}
            {fields.map((field) => (
                <SetupFieldInput
                    key={field.name}
                    field={field}
                    value={values[field.name] ?? ""}
                    onChange={(value) => setValues((v) => ({...v, [field.name]: value}))}
                />
            ))}
        </>
    )

    return (
        <div className="flex flex-col gap-5">
            {/* hero */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="m-0 text-lg font-semibold text-colorText">{name}</h2>
                    <p className="m-0 text-[13px] leading-relaxed text-colorTextSecondary">
                        {isSlack
                            ? `Let your team talk to ${agentName} from Slack.`
                            : `Talk to ${agentName} from Telegram on any device.`}
                    </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-solid border-colorBorderSecondary bg-colorBgContainer">
                        {platformLogo(platform, 22)}
                    </span>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-solid border-colorBorderSecondary bg-colorBgContainer text-colorText">
                        <AgentaMark size={22} />
                    </span>
                </div>
            </div>

            {error ? (
                <Alert
                    type="error"
                    showIcon
                    message={`${name} is not connected`}
                    description={error}
                    data-testid="channels-connect-error"
                />
            ) : null}

            <Segmented
                block
                options={modeOptions}
                value={mode}
                onChange={(value) => {
                    clearTimeout(timer.current)
                    setMode(value as ChannelInstallMode)
                    setError(null)
                    setAuthorizing(false)
                    setSaving(false)
                }}
            />

            {/* SLACK · hosted */}
            {isSlack && mode === "hosted" ? (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <h3 className="m-0 text-[15px] font-semibold text-colorText">
                            Add the Agenta app to your workspace
                        </h3>
                        <p className="m-0 text-xs leading-relaxed text-colorTextSecondary">
                            Slack opens in a new window and asks you to approve {hostedHandle} once.
                            One workspace routes to one agent — this workspace will route to{" "}
                            {agentName}.
                        </p>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
                        {[
                            [
                                "Reads only where it is added",
                                "Channels you pick, plus direct messages. No access to other channels.",
                            ],
                            [
                                "Answers when mentioned",
                                `In channels, ${agentName} replies in a thread when someone mentions ${hostedHandle}.`,
                            ],
                            [
                                "Kept up to date by Agenta",
                                "No manifest, no secrets to rotate. Disconnect any time.",
                            ],
                        ].map(([title, body], i) => (
                            <div
                                key={title}
                                className={`flex items-start gap-2.5 p-3 ${
                                    i
                                        ? "border-0 border-t border-solid border-colorBorderSecondary"
                                        : ""
                                }`}
                            >
                                <Check
                                    size={14}
                                    weight="bold"
                                    className="mt-0.5 flex-shrink-0 text-colorSuccess"
                                />
                                <span className="flex flex-col gap-0.5">
                                    <span className="text-[13px] font-medium text-colorText">
                                        {title}
                                    </span>
                                    <span className="text-xs text-colorTextSecondary">{body}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                    <Button
                        variant="default"
                        className="w-full"
                        disabled={authorizing}
                        onClick={() => void startSlackInstall()}
                        data-testid="channels-add-to-slack"
                    >
                        {authorizing ? "Waiting for Slack…" : "Add to Slack"}
                    </Button>
                    {authorizing ? (
                        <div className="flex flex-col items-center gap-1.5 text-xs text-colorTextSecondary">
                            <div className="flex items-center gap-2">
                                <Spinner size="small" /> Waiting for you to approve in Slack…
                                <button
                                    type="button"
                                    className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorTextSecondary underline underline-offset-2"
                                    onClick={() => {
                                        clearTimeout(timer.current)
                                        setAuthorizing(false)
                                    }}
                                >
                                    cancel
                                </button>
                            </div>
                            {slackInstallUrl ? (
                                <a
                                    href={slackInstallUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-colorPrimary"
                                >
                                    Slack didn’t open? Open it here.
                                </a>
                            ) : null}
                        </div>
                    ) : null}
                    <span className="text-center text-xs text-colorTextTertiary">
                        Direct messages work right away. Mention {hostedHandle} in a channel it was
                        added to.
                    </span>
                </div>
            ) : null}

            {/* SLACK · custom */}
            {isSlack && mode === "custom" ? (
                <div className="flex flex-col gap-5">
                    {slackStep === "choose" ? (
                        <>
                            <h3 className="m-0 text-[15px] font-semibold text-colorText">
                                How do you want to connect a Slack app?
                            </h3>
                            <div className="overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
                                {[
                                    {
                                        title: "New app",
                                        body: `Start from a manifest we fill in for ${agentName}`,
                                        icon: <FileText size={20} />,
                                        onClick: () => setSlackStep("guide"),
                                    },
                                    {
                                        title: "Existing app",
                                        body: "Reuse an app you already created in Slack",
                                        icon: <Plug size={20} />,
                                        onClick: () => setSlackStep("creds"),
                                    },
                                ].map((choice, i) => (
                                    <button
                                        key={choice.title}
                                        type="button"
                                        onClick={choice.onClick}
                                        className={`flex w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent p-4 text-left hover:bg-colorFillQuaternary ${
                                            i
                                                ? "border-0 border-t border-solid border-colorBorderSecondary"
                                                : ""
                                        }`}
                                    >
                                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-solid border-colorBorderSecondary text-colorTextSecondary">
                                            {choice.icon}
                                        </span>
                                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="text-sm font-medium text-colorText">
                                                {choice.title}
                                            </span>
                                            <span className="text-xs text-colorTextSecondary">
                                                {choice.body}
                                            </span>
                                        </span>
                                        <CaretRight
                                            size={14}
                                            className="flex-shrink-0 text-colorTextTertiary"
                                        />
                                    </button>
                                ))}
                            </div>
                            <span className="text-xs text-colorTextTertiary">
                                One app equals one agent: the app you create here answers only as{" "}
                                {agentName}.
                            </span>
                        </>
                    ) : null}

                    {slackStep === "guide" ? (
                        <>
                            <div className="flex flex-col gap-1">
                                <h3 className="m-0 text-[15px] font-semibold text-colorText">
                                    Set up the app in Slack
                                </h3>
                                <p className="m-0 text-xs leading-relaxed text-colorTextSecondary">
                                    Takes about two minutes. Slack opens in a new tab.
                                </p>
                            </div>

                            <StepRow
                                index={1}
                                title="Copy the manifest"
                                body={`Contains the scopes, events and the request URL ${agentName} needs.`}
                            >
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="default"
                                        size="sm"
                                        disabled={!setup?.manifest}
                                        onClick={async () => {
                                            if (!setup?.manifest) return
                                            const ok = await copyText(setup.manifest)
                                            setCopied(ok)
                                            if (!ok) setManifestOpen(true)
                                            later(() => setCopied(false), 1800)
                                        }}
                                    >
                                        {copied ? (
                                            <Check size={13} weight="bold" />
                                        ) : (
                                            <Copy size={13} />
                                        )}
                                        {copied ? "Copied" : "Copy manifest"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!setup?.manifest}
                                        onClick={() => setManifestOpen((open) => !open)}
                                    >
                                        {manifestOpen ? "Hide manifest" : "Review manifest"}
                                    </Button>
                                </div>
                                {setupLoading ? (
                                    <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                                        <Spinner size="small" /> Loading the manifest…
                                    </div>
                                ) : null}
                                {!setupLoading && setup && !setup.manifest ? (
                                    <span className="text-xs text-colorWarning">
                                        No manifest is available for this deployment.
                                    </span>
                                ) : null}
                                {manifestOpen && setup?.manifest ? (
                                    <pre className="m-0 max-h-56 overflow-auto rounded-md border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 text-[11px] leading-snug text-colorText">
                                        {setup.manifest}
                                    </pre>
                                ) : null}
                            </StepRow>

                            <StepRow
                                index={2}
                                title="Create the app from the manifest"
                                body="On api.slack.com/apps choose Create New App → From an app manifest, paste, and confirm."
                            >
                                <div>
                                    <Button variant="outline" size="sm" asChild>
                                        <a
                                            href="https://api.slack.com/apps"
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            <ArrowSquareOut size={13} />
                                            Open api.slack.com/apps
                                        </a>
                                    </Button>
                                </div>
                            </StepRow>

                            <StepRow
                                index={3}
                                title="Install it to your workspace"
                                body="Approve the scopes when Slack asks. The next step needs the bot token from OAuth & Permissions and the signing secret from Basic information."
                            />

                            <div className="grid grid-cols-2 gap-2.5 pt-1">
                                <Button variant="outline" onClick={() => setSlackStep("choose")}>
                                    Back
                                </Button>
                                <Button variant="default" onClick={() => setSlackStep("creds")}>
                                    Next
                                </Button>
                            </div>
                        </>
                    ) : null}

                    {slackStep === "creds" ? (
                        <>
                            <div className="flex flex-col gap-1">
                                <h3 className="m-0 text-[15px] font-semibold text-colorText">
                                    Add the app credentials
                                </h3>
                                <p className="m-0 text-xs leading-relaxed text-colorTextSecondary">
                                    We check them with Slack before saving. Secrets stay masked
                                    after you save.
                                </p>
                            </div>
                            {fieldsForm}
                            <div className="grid grid-cols-2 gap-2.5 pt-1">
                                <Button variant="outline" onClick={() => setSlackStep("choose")}>
                                    Back
                                </Button>
                                <Button
                                    variant="default"
                                    disabled={!fieldsValid || saving || fields.length === 0}
                                    onClick={submitCustom}
                                    data-testid="channels-connect-custom"
                                >
                                    Connect to Slack
                                </Button>
                            </div>
                        </>
                    ) : null}
                </div>
            ) : null}

            {/* TELEGRAM · hosted */}
            {!isSlack && mode === "hosted" ? (
                <div className="flex flex-col gap-4">
                    {answeringAgentName ? (
                        <p className="m-0 rounded-md border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2.5 text-xs text-colorTextSecondary">
                            This project&apos;s Telegram currently answers as{" "}
                            <strong className="font-medium text-colorText">
                                {answeringAgentName}
                            </strong>
                            . Connecting here switches it to {agentName}.
                        </p>
                    ) : null}
                    {tgStep === "preparing" ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-colorTextSecondary">
                            <Spinner size="small" /> Preparing your link…
                        </div>
                    ) : null}

                    {tgStep === "unavailable" ? (
                        <div className="grid grid-cols-2 gap-2.5">
                            <Button variant="outline" onClick={() => void mintTelegramLink()}>
                                Try again
                            </Button>
                            <Button variant="default" onClick={() => setMode("custom")}>
                                Use your own bot
                            </Button>
                        </div>
                    ) : null}

                    {tgStep === "qr" && tgLink ? (
                        <>
                            <div className="flex flex-col items-center gap-4 py-2 text-center">
                                <div className="relative box-border h-[180px] w-[180px] rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer p-3.5 text-colorText">
                                    <QrCode
                                        value={tgLink.url}
                                        size={150}
                                        label={`QR code: open ${telegramHandle} in Telegram`}
                                    />
                                    <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-colorBgContainer">
                                        {platformLogo("telegram", 20)}
                                    </span>
                                </div>
                                <div className="flex max-w-[400px] flex-col gap-1.5">
                                    <h3 className="m-0 text-[15px] font-semibold text-colorText">
                                        Continue in Telegram
                                    </h3>
                                    <p className="m-0 text-xs leading-relaxed text-colorTextSecondary">
                                        Scan with your phone, or open the link. {telegramHandle}{" "}
                                        will ask you to link this chat — the link works once and
                                        expires in{" "}
                                        {Math.max(1, Math.round(tgLink.expiresInSeconds / 60))}{" "}
                                        minutes.
                                    </p>
                                </div>
                            </div>
                            <Button variant="default" className="w-full" asChild>
                                <a
                                    href={tgLink.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={() => setTgStep("waiting")}
                                    data-testid="channels-continue-in-telegram"
                                >
                                    <ArrowSquareOut size={13} />
                                    Continue in Telegram
                                </a>
                            </Button>
                            <button
                                type="button"
                                className="cursor-pointer self-center border-0 bg-transparent p-0 text-xs text-colorPrimary"
                                onClick={async () => {
                                    const ok = await copyText(tgLink.url)
                                    setLinkCopied(ok)
                                    later(() => setLinkCopied(false), 1800)
                                }}
                            >
                                {linkCopied ? "Link copied" : "Copy the link instead"}
                            </button>
                        </>
                    ) : null}

                    {tgStep === "waiting" ? (
                        <>
                            <div
                                className="flex items-center gap-2 text-[13px] text-colorTextSecondary"
                                data-testid="channels-telegram-waiting"
                            >
                                <Spinner size="small" /> Waiting for you to tap{" "}
                                <strong className="font-medium text-colorText">Start</strong> in
                                Telegram. This page updates on its own.
                            </div>
                            <div className="flex flex-col gap-1.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-3">
                                <div className="max-w-[92%] rounded-lg bg-colorBgContainer p-2.5 text-xs leading-normal text-colorText shadow-sm">
                                    <div className="mb-1 flex items-center gap-1.5">
                                        <span className="flex h-4 w-4 text-colorText">
                                            <AgentaMark size={16} />
                                        </span>
                                        <span className="font-medium">{telegramHandle}</span>
                                    </div>
                                    Once you tap Start, this chat is linked to{" "}
                                    <strong className="font-medium">{agentName}</strong> and the
                                    agent answers here.
                                </div>
                            </div>
                            <div className="flex items-center justify-center gap-4">
                                <button
                                    type="button"
                                    className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorPrimary"
                                    onClick={() => setTgStep("qr")}
                                >
                                    Show the QR code again
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorTextSecondary underline underline-offset-2"
                                    onClick={() => void onConnected()}
                                >
                                    I already linked this chat
                                </button>
                            </div>
                        </>
                    ) : null}

                    {tgStep === "expired" ? (
                        <>
                            <Alert
                                type="warning"
                                showIcon
                                message="The link expired"
                                description="Nothing was linked. Get a new link and open it within the time shown."
                            />
                            <Button
                                variant="default"
                                className="w-full"
                                onClick={() => void mintTelegramLink()}
                            >
                                Get a new link
                            </Button>
                        </>
                    ) : null}

                    {tgStep === "linked" ? (
                        <div
                            className="flex items-center gap-2 rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer p-3 text-[13px] text-colorText"
                            data-testid="channels-telegram-linked"
                        >
                            <Check size={14} weight="bold" className="text-colorSuccess" />
                            Linked. {agentName} answers in that Telegram chat now.
                        </div>
                    ) : null}
                </div>
            ) : null}

            {/* TELEGRAM · custom */}
            {!isSlack && mode === "custom" ? (
                <div className="flex flex-col gap-5">
                    <StepRow
                        index={1}
                        title="Create a bot with @BotFather"
                        body="In Telegram, send /newbot, choose a display name and a username ending in “bot”. You pick the name and avatar people see."
                    >
                        <div>
                            <Button variant="outline" size="sm" asChild>
                                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                                    <ArrowSquareOut size={13} />
                                    Open @BotFather
                                </a>
                            </Button>
                        </div>
                    </StepRow>
                    <StepRow
                        index={2}
                        title="Paste the bot token"
                        body="We check it with Telegram before saving. It stays masked from then on."
                    >
                        {fieldsForm}
                    </StepRow>
                    <Button
                        variant="default"
                        className="w-full"
                        disabled={!fieldsValid || saving || fields.length === 0}
                        onClick={submitCustom}
                        data-testid="channels-connect-custom"
                    >
                        Connect to Telegram
                    </Button>
                </div>
            ) : null}

            {saving ? (
                <div className="flex items-center justify-center gap-2.5 py-2 text-[13px] text-colorTextSecondary">
                    <Spinner size="small" /> Connecting {name}…
                </div>
            ) : null}

            {/* workspaceName is surfaced in the hosted copy for Slack; kept referenced for /m parity. */}
            <span className="sr-only">{workspaceName}</span>
        </div>
    )
}

const SetupFieldInput = ({
    field,
    value,
    onChange,
}: {
    field: ChannelSetupField
    value: string
    onChange: (value: string) => void
}) => (
    <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-colorText">{field.label}</span>
            {field.required ? (
                <span className="text-xs text-colorTextTertiary">Required</span>
            ) : null}
        </span>
        {field.help ? <span className="text-xs text-colorTextSecondary">{field.help}</span> : null}
        {field.secret ? (
            <PasswordInput
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="font-mono text-xs"
                data-testid={`channels-field-${field.name}`}
            />
        ) : (
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="font-mono text-xs"
                data-testid={`channels-field-${field.name}`}
            />
        )}
    </label>
)
