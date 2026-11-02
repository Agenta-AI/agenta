import {useEffect, useRef, useState} from "react"

import {Alert, Button, Input, PasswordInput, Segmented, Spinner} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretRight, Check, Copy, FileText, Plug} from "@phosphor-icons/react"

import {DIRECT_MESSAGES_CHAT, platformLabel} from "./helpers"
import {AgentaMark, platformLogo, QrPlaceholder} from "./icons"
import type {ChannelConnection, ChannelInstallMode, ChannelPlatform} from "./types"

/**
 * The connect flow (empty → connecting → connected, plus the Telegram link-waiting and the
 * Slack install-failed states). Shared by the desktop drawer and the /m sheet.
 *
 * FIRST PASS / PLACEHOLDER: there is no OAuth or bot handshake wired. "Add to Slack",
 * "Continue in Telegram" and the credential/token submits are simulated with short timers so the
 * connecting / waiting / linked / error states are all reachable for visual review. When the
 * backend lands, replace the `simulate*` handlers with real calls and lift `onConnected` to a
 * mutation.
 */

export interface ChannelConnectFlowProps {
    platform: ChannelPlatform
    agentName: string
    workspaceName?: string
    /** Set once to preview the "install failed" state (placeholder wiring only). */
    forceInstallError?: boolean
    onConnected: (connection: ChannelConnection) => void
}

type SlackCustomStep = "choose" | "guide" | "creds"
type TelegramHostedStep = "qr" | "waiting" | "linked"

const STEP_MARKER =
    "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-colorFillQuaternary text-xs font-medium text-colorText"

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

export const ChannelConnectFlow = ({
    platform,
    agentName,
    workspaceName = "your workspace",
    forceInstallError = false,
    onConnected,
}: ChannelConnectFlowProps) => {
    const isSlack = platform === "slack"
    const name = platformLabel(platform)

    const [mode, setMode] = useState<ChannelInstallMode>("hosted")
    const [error, setError] = useState(false)
    const [authorizing, setAuthorizing] = useState(false)
    const [saving, setSaving] = useState(false)

    // Slack custom
    const [slackStep, setSlackStep] = useState<SlackCustomStep>("choose")
    const [appName, setAppName] = useState(agentName)
    const [appHandle, setAppHandle] = useState(
        agentName.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "agent",
    )
    const [creds, setCreds] = useState({id: "", secret: "", signing: ""})
    const [copied, setCopied] = useState(false)

    // Telegram
    const [tgStep, setTgStep] = useState<TelegramHostedStep>("qr")
    const [tgToken, setTgToken] = useState("")
    const [allowed, setAllowed] = useState("")

    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(timer.current), [])
    const later = (fn: () => void, ms: number) => {
        clearTimeout(timer.current)
        timer.current = setTimeout(fn, ms)
    }

    const finish = (kind: ChannelInstallMode) => {
        setSaving(true)
        setAuthorizing(false)
        later(() => {
            setSaving(false)
            onConnected({
                platform,
                kind,
                status: "connected",
                dm: "allow",
                group: "allow",
                chats: [DIRECT_MESSAGES_CHAT],
            })
        }, 900)
    }

    // Placeholder OAuth: pretend to wait for the popup, then either fail or succeed.
    const simulateSlackHosted = () => {
        setAuthorizing(true)
        setError(false)
        later(() => {
            if (forceInstallError) {
                setAuthorizing(false)
                setError(true)
            } else {
                finish("hosted")
            }
        }, 1500)
    }

    const modeOptions = isSlack
        ? [
              {label: "Agenta app", value: "hosted"},
              {label: "Custom app", value: "custom"},
          ]
        : [
              {label: "Agenta bot", value: "hosted"},
              {label: "Your own bot", value: "custom"},
          ]

    const credsValid = Boolean(creds.id && creds.secret && creds.signing)
    const nameValid = appName.trim().length > 0 && appHandle.trim().length > 0

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
                    message="Slack didn’t finish the install"
                    description="The authorization window was closed or Slack returned an error. Nothing was saved — try again."
                />
            ) : null}

            <Segmented
                block
                options={modeOptions}
                value={mode}
                onChange={(value) => {
                    clearTimeout(timer.current)
                    setMode(value as ChannelInstallMode)
                    setError(false)
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
                            Slack opens in a new window and asks you to approve @agenta once. One
                            workspace routes to one agent — this workspace will route to {agentName}
                            .
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
                                `In channels, ${agentName} replies in a thread when someone mentions @agenta.`,
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
                        disabled={authorizing || saving}
                        onClick={simulateSlackHosted}
                    >
                        {authorizing ? "Waiting for Slack…" : "Add to Slack"}
                    </Button>
                    {authorizing ? (
                        <div className="flex items-center justify-center gap-2 text-xs text-colorTextSecondary">
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
                    ) : null}
                    <span className="text-center text-xs text-colorTextTertiary">
                        You pick channels after connecting. Direct messages work right away.
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
                                title="Name the app"
                                body="What your team sees in Slack. Both can be changed later in Slack."
                            >
                                <div className="grid grid-cols-2 gap-2.5">
                                    <label className="flex flex-col gap-1.5">
                                        <span className="text-xs text-colorTextSecondary">
                                            Name
                                        </span>
                                        <Input
                                            value={appName}
                                            onChange={(e) =>
                                                setAppName(e.target.value.slice(0, 35))
                                            }
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1.5">
                                        <span className="text-xs text-colorTextSecondary">
                                            Handle
                                        </span>
                                        <Input
                                            value={appHandle}
                                            onChange={(e) =>
                                                setAppHandle(
                                                    e.target.value
                                                        .replace(/[^a-z0-9_-]/gi, "")
                                                        .toLowerCase()
                                                        .slice(0, 21),
                                                )
                                            }
                                        />
                                    </label>
                                </div>
                            </StepRow>

                            <StepRow
                                index={2}
                                title="Copy the manifest"
                                body={`Contains the scopes, events and slash command ${agentName} needs — filled in with the name above.`}
                            >
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="default"
                                        size="sm"
                                        onClick={() => {
                                            setCopied(true)
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
                                    <Button variant="outline" size="sm">
                                        Review scopes
                                    </Button>
                                </div>
                            </StepRow>

                            <StepRow
                                index={3}
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
                                index={4}
                                title="Install it to your workspace"
                                body="Approve the scopes when Slack asks. Then open Basic information — the next step needs three values from it."
                            />

                            <div className="grid grid-cols-2 gap-2.5 pt-1">
                                <Button variant="outline" onClick={() => setSlackStep("choose")}>
                                    Back
                                </Button>
                                <Button
                                    variant="default"
                                    disabled={!nameValid}
                                    onClick={() => setSlackStep("creds")}
                                >
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
                                    From your app’s Basic information → App credentials. Secrets
                                    stay masked after you save.
                                </p>
                            </div>
                            <SecretField
                                label="Client ID"
                                help="From Basic information → App credentials"
                                placeholder="1234567890.1234567890"
                                value={creds.id}
                                onChange={(value) => setCreds((c) => ({...c, id: value}))}
                            />
                            <SecretField
                                secret
                                label="Client secret"
                                help="Click Show in Slack before copying, or the value is masked"
                                value={creds.secret}
                                onChange={(value) => setCreds((c) => ({...c, secret: value}))}
                            />
                            <SecretField
                                secret
                                label="Signing secret"
                                help="Lets Agenta verify that events really come from Slack"
                                value={creds.signing}
                                onChange={(value) => setCreds((c) => ({...c, signing: value}))}
                            />
                            <div className="grid grid-cols-2 gap-2.5 pt-1">
                                <Button variant="outline" onClick={() => setSlackStep("choose")}>
                                    Back
                                </Button>
                                <Button
                                    variant="default"
                                    disabled={!credsValid || saving}
                                    onClick={() => finish("custom")}
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
                    {tgStep === "qr" ? (
                        <>
                            <div className="flex flex-col items-center gap-4 py-2 text-center">
                                <div className="relative box-border h-[180px] w-[180px] rounded-xl border border-solid border-colorBorderSecondary bg-colorWhite p-3.5">
                                    <QrPlaceholder />
                                    <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-colorWhite">
                                        {platformLogo("telegram", 20)}
                                    </span>
                                </div>
                                <div className="flex max-w-[400px] flex-col gap-1.5">
                                    <h3 className="m-0 text-[15px] font-semibold text-colorText">
                                        Continue in Telegram
                                    </h3>
                                    <p className="m-0 text-xs leading-relaxed text-colorTextSecondary">
                                        Scan with your phone, or open the link. @agenta will ask you
                                        to link your account — the link works once and expires in 30
                                        minutes.
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant="default"
                                className="w-full"
                                onClick={() => setTgStep("waiting")}
                            >
                                <ArrowSquareOut size={13} />
                                Continue in Telegram
                            </Button>
                        </>
                    ) : null}

                    {tgStep === "waiting" ? (
                        <>
                            <div className="flex items-center gap-2 text-[13px] text-colorTextSecondary">
                                <Spinner size="small" /> Waiting for you to tap{" "}
                                <strong className="font-medium text-colorText">Link account</strong>{" "}
                                in Telegram. This page updates on its own.
                            </div>
                            <div className="flex flex-col gap-1.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-3">
                                <div className="max-w-[92%] rounded-lg bg-colorBgContainer p-2.5 text-xs leading-normal text-colorText shadow-sm">
                                    <div className="mb-1 flex items-center gap-1.5">
                                        <span className="flex h-4 w-4 text-colorText">
                                            <AgentaMark size={16} />
                                        </span>
                                        <span className="font-medium">@agenta</span>
                                    </div>
                                    Link this Telegram account to{" "}
                                    <strong className="font-medium">{agentName}</strong>? The link
                                    below works once and expires in 30 minutes.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setTgStep("linked")}
                                    className="inline-flex h-8 max-w-[92%] cursor-pointer items-center justify-center rounded-lg border-0 bg-[#2e7d3a] text-xs font-medium text-white"
                                >
                                    Link account
                                </button>
                                <span className="text-[10px] text-colorTextTertiary">
                                    Placeholder: tap the button to simulate the link.
                                </span>
                            </div>
                            <button
                                type="button"
                                className="cursor-pointer self-center border-0 bg-transparent p-0 text-xs text-colorPrimary"
                                onClick={() => setTgStep("qr")}
                            >
                                Show the QR code again
                            </button>
                        </>
                    ) : null}

                    {tgStep === "linked" ? (
                        <div className="flex items-center gap-2 rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer p-3 text-[13px] text-colorText">
                            <Check size={14} weight="bold" className="text-colorSuccess" />
                            Linked to your Telegram account
                        </div>
                    ) : null}

                    <div className="flex flex-col gap-1.5 border-0 border-t border-solid border-colorBorderSecondary pt-3">
                        <span className="text-[13px] font-medium text-colorText">
                            Allowed Telegram user IDs
                        </span>
                        <p className="m-0 text-xs leading-relaxed text-colorTextSecondary">
                            Comma-separated numeric IDs from @userinfobot. Your own account is added
                            when you link it. Without a list, anyone who finds @agenta can message{" "}
                            {agentName}.
                        </p>
                        <Input
                            value={allowed}
                            onChange={(e) => setAllowed(e.target.value)}
                            placeholder="123456789, 987654321"
                            className="font-mono text-xs"
                        />
                    </div>

                    {tgStep === "linked" ? (
                        <Button
                            variant="default"
                            className="w-full"
                            disabled={saving}
                            onClick={() => finish("hosted")}
                        >
                            Connect to Telegram
                        </Button>
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
                        <PasswordInput
                            value={tgToken}
                            onChange={(e) => setTgToken(e.target.value)}
                            placeholder="123456789:AAF…"
                            className="font-mono text-xs"
                        />
                    </StepRow>
                    <StepRow
                        index={3}
                        title="Choose who can message it"
                        body={`Comma-separated Telegram user IDs from @userinfobot. Leave empty and anyone who finds the bot can talk to ${agentName}.`}
                    >
                        <Input
                            value={allowed}
                            onChange={(e) => setAllowed(e.target.value)}
                            placeholder="123456789, 987654321"
                            className="font-mono text-xs"
                        />
                    </StepRow>
                    <Button
                        variant="default"
                        className="w-full"
                        disabled={!tgToken || saving}
                        onClick={() => finish("custom")}
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

const SecretField = ({
    label,
    help,
    placeholder,
    value,
    onChange,
    secret,
}: {
    label: string
    help: string
    placeholder?: string
    value: string
    onChange: (value: string) => void
    secret?: boolean
}) => (
    <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-colorText">{label}</span>
            <span className="text-xs text-colorTextTertiary">Required</span>
        </span>
        <span className="text-xs text-colorTextSecondary">{help}</span>
        {secret ? (
            <PasswordInput
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="font-mono text-xs"
            />
        ) : (
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="font-mono text-xs"
            />
        )}
    </label>
)
