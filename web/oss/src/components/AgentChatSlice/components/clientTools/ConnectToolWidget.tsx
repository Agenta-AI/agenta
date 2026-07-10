/**
 * Connect widget — the `request_connection` / `render.kind: "connect"` client tool (#4920).
 *
 * The agent asked for a connection it lacks (e.g. GitHub). This widget runs the Agenta OAuth flow in
 * the playground and settles the parked call with a **reference, never a secret**: the runner
 * re-resolves the credential from the project vault on resume. It reuses the existing connection
 * machinery (`useToolsConnections` → `POST /tools/connections/`, then a popup on the returned
 * `redirect_url`) rather than reinventing the OAuth call.
 *
 * Security (hard requirement, design §"Security"): the popup posts back a `tools:oauth:complete`
 * message; we trust it ONLY when `event.origin` equals the Agenta API origin (the callback page's
 * origin) and the payload shape matches. Everything else is dropped. The callback also tags the
 * message with the connection's `slug`/`integration`, so when several connect widgets are live at
 * once each settles only on its OWN completion (never on a sibling's).
 *
 * Settle on every terminal path (design §"Settle on every path"), so the run never hangs:
 *   success → {connected:true, integration, slug} · cancel/abandon → {connected:false,
 *   reason:"cancelled"} · timeout → {connected:false, reason:"timeout"} · failure → errorText.
 *
 * Result UX is U1 — an inline status chip in the same visual language as approve/deny: "Connect
 * GitHub" → "Connecting GitHub…" → "GitHub connected" ✓, or "Connection not completed" + Retry.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {
    ArrowClockwise,
    CheckCircle,
    Hourglass,
    Plugs,
    Spinner,
    Warning,
} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {useToolsConnections} from "../../../pages/settings/Tools/hooks/useToolsConnections"

import type {ClientToolHandlerProps} from "./types"

const {Text} = Typography

/**
 * No terminal signal within this bound settles the call as a timeout so the run can't wait forever.
 * Armed only once the popup is open (the user is mid-flow). 3 minutes covers a real OAuth consent.
 * NOTE for Mahmoud: confirm the bound — open question §"abandon timeout".
 */
const CONNECT_TIMEOUT_MS = 180_000
/** Popup-closed poll cadence, matching the existing ConnectModal. */
const POPUP_POLL_MS = 1000

/**
 * The runner parks only ONE interaction per turn; a second `request_connection` in the same step is
 * force-settled with this sentinel and RE-REQUESTED next turn (services/runner otel.ts
 * `TOOL_NOT_EXECUTED_PAUSED`). It is a deferral, not a failure — render it quietly with no Retry, so
 * the user waits for the agent's re-ask instead of starting a flow that races it.
 */
const DEFERRED_SENTINEL = "DEFERRED_NOT_EXECUTED"

/** The settled call's reference shape (what the runner re-resolves against). */
interface ConnectOutput {
    connected?: boolean
    integration?: string
    slug?: string
    reason?: string
}

/** `github` → `GitHub`-ish: a readable label without a provider catalog lookup. */
const prettyIntegration = (key: string): string =>
    key ? key.charAt(0).toUpperCase() + key.slice(1) : "the service"

/** Read the API origin the OAuth callback page posts from; null if it can't be resolved. */
const agentaApiOrigin = (): string | null => {
    try {
        const url = getAgentaApiUrl()
        if (!url) return null
        return new URL(url, typeof window !== "undefined" ? window.location.href : undefined).origin
    } catch {
        return null
    }
}

type Phase = "idle" | "connecting" | "error"

const ConnectToolWidget = ({meta, settle}: ClientToolHandlerProps) => {
    const input = (meta.input ?? {}) as Record<string, unknown>
    const integration = typeof input.integration === "string" ? input.integration : ""
    // Connection slug: the call may pin one; default to the integration key. The output carries it
    // back as the reference the runner re-resolves.
    const slug =
        typeof input.slug === "string" && input.slug ? input.slug : integration || "default"
    const mode = input.mode === "api_key" ? "api_key" : "oauth"
    const label = prettyIntegration(integration)

    // A runner-deferred sibling settles as an error carrying the deferral sentinel (not a real
    // connection failure); see DEFERRED_SENTINEL.
    const partErrorText = (meta.part as {errorText?: unknown}).errorText
    const deferredByRunner =
        meta.state === "output-error" &&
        typeof partErrorText === "string" &&
        partErrorText.startsWith(DEFERRED_SENTINEL)

    const {handleCreate, invalidate} = useToolsConnections(integration)

    const [phase, setPhase] = useState<Phase>("idle")
    const [errorText, setErrorText] = useState<string | null>(null)
    // A retry started AFTER the parked call already settled (as a failure) succeeded. The settled
    // part can't be re-resolved, but the connection now exists in the vault, so we flip the chip to
    // "connected" — the agent's re-ask resolves cleanly on its next turn.
    const [manuallyConnected, setManuallyConnected] = useState(false)
    // The live flow's terminal result, held locally so the chip paints the instant we settle —
    // `meta.settled` only flips a render later (after `addToolOutput` propagates), and without this
    // the widget would stay on "Connecting…" until then.
    const [outcome, setOutcome] = useState<{connected: boolean} | null>(null)

    // One-shot guard so the parked call settles exactly once, plus shared cleanup for the running
    // popup's listener/poll/timeout.
    const settledRef = useRef(false)
    const popupRef = useRef<Window | null>(null)
    const cleanupRef = useRef<(() => void) | null>(null)

    const teardown = useCallback(() => {
        cleanupRef.current?.()
        cleanupRef.current = null
        popupRef.current = null
    }, [])

    // Settle the parked part exactly once (success/cancel/timeout/failure all route through here).
    const finish = useCallback(
        (result: ConnectOutput | {errorText: string}) => {
            if (settledRef.current) return
            settledRef.current = true
            teardown()
            // Leave "connecting" and record the terminal result so the chip paints now.
            setPhase("idle")
            if ("errorText" in result) {
                setOutcome({connected: false})
                settle({errorText: result.errorText})
            } else {
                setOutcome({connected: result.connected === true})
                settle({output: result as Record<string, unknown>})
            }
        },
        [settle, teardown],
    )

    useEffect(() => () => teardown(), [teardown])

    /**
     * Run the Agenta OAuth flow: create the connection, open the popup, and watch its three terminal
     * signals (origin-validated success message, popup closed without success, or timeout backstop).
     *
     * `settleParkedCall` distinguishes the two callers:
     *  - the live parked interaction (`true`): each terminal signal settles the parked tool call so
     *    the run resumes;
     *  - a manual retry after the call already settled (`false`): nothing to settle, so success just
     *    flips the local "connected" chip and primes the vault for the agent's re-ask.
     */
    const runConnect = useCallback(
        async (settleParkedCall: boolean) => {
            if (phase === "connecting") return
            if (settleParkedCall && settledRef.current) return
            setErrorText(null)
            setPhase("connecting")
            try {
                const result = await handleCreate({slug, name: slug, mode})
                const redirectUrl =
                    typeof result.connection?.data?.redirect_url === "string"
                        ? result.connection.data.redirect_url
                        : undefined

                const onSuccess = () => {
                    invalidate()
                    if (settleParkedCall) finish({connected: true, integration, slug})
                    else {
                        setManuallyConnected(true)
                        setPhase("idle")
                    }
                }

                if (!redirectUrl) {
                    // No OAuth step (e.g. api_key created inline): the connection already exists.
                    onSuccess()
                    return
                }

                const popup = window.open(
                    redirectUrl,
                    "tools_oauth",
                    "width=600,height=700,popup=yes",
                )
                if (!popup) {
                    setPhase("error")
                    setErrorText("Couldn’t open the connection window. Allow popups and retry.")
                    return
                }
                popupRef.current = popup

                const apiOrigin = agentaApiOrigin()
                let succeeded = false

                const onMessage = (event: MessageEvent) => {
                    // HARD requirement: only trust the callback from the Agenta API origin.
                    if (apiOrigin && event.origin !== apiOrigin) return
                    const data = event.data as {
                        type?: unknown
                        slug?: unknown
                        integration?: unknown
                    } | null
                    if (!data || data.type !== "tools:oauth:complete") return
                    // Several connect widgets can be live at once (an agent may ask for
                    // multiple connections in one turn). The callback tags the completion with
                    // its connection identity, so a widget settles ONLY on its own completion —
                    // otherwise the first finished flow would mark every open widget connected.
                    // A legacy callback without identity keeps the prior single-flow behavior.
                    if (typeof data.slug === "string" && data.slug !== slug) return
                    else if (
                        typeof data.slug !== "string" &&
                        typeof data.integration === "string" &&
                        data.integration !== integration
                    )
                        return
                    succeeded = true
                    teardown()
                    onSuccess()
                }
                window.addEventListener("message", onMessage)

                const poll = window.setInterval(() => {
                    if (!popupRef.current?.closed || succeeded) return
                    // Abandon: closed without a success message.
                    teardown()
                    if (settleParkedCall)
                        finish({connected: false, integration, slug, reason: "cancelled"})
                    else setPhase("idle")
                }, POPUP_POLL_MS)

                const timeout = window.setTimeout(() => {
                    if (succeeded) return
                    teardown()
                    if (settleParkedCall)
                        finish({connected: false, integration, slug, reason: "timeout"})
                    else setPhase("idle")
                }, CONNECT_TIMEOUT_MS)

                cleanupRef.current = () => {
                    window.removeEventListener("message", onMessage)
                    window.clearInterval(poll)
                    window.clearTimeout(timeout)
                    try {
                        popupRef.current?.close()
                    } catch {
                        // best effort
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : "Connection failed."
                // A create failure is terminal for the parked call: settle so the run resumes; for a
                // manual retry just surface the reason with another Retry.
                setPhase("error")
                setErrorText(message)
                if (settleParkedCall) finish({connected: false, integration, slug, reason: message})
            }
        },
        [phase, handleCreate, slug, mode, invalidate, finish, teardown, integration],
    )

    // Explicit cancel while the popup is open: settle the parked call as cancelled (or, for a manual
    // retry, just stop).
    const cancel = useCallback(() => {
        teardown()
        if (!settledRef.current) finish({connected: false, integration, slug, reason: "cancelled"})
        else setPhase("idle")
    }, [finish, teardown, integration, slug])

    // ── Connecting: popup open (either the live flow or a manual retry) ──────────────────────────
    if (phase === "connecting") {
        return (
            <ChipRow icon={<Spinner size={13} className="animate-spin text-colorPrimary" />}>
                <Text type="secondary" className="!text-xs">
                    Connecting {label}…
                </Text>
                <Button type="text" onClick={cancel} className="!px-2">
                    Cancel
                </Button>
            </ChipRow>
        )
    }

    // ── Settled: the result chip (U1). `outcome` covers the render before `meta.settled` flips. ──
    if (meta.settled || outcome) {
        const output = (meta.output ?? {}) as ConnectOutput
        if (manuallyConnected || output.connected === true || outcome?.connected === true) {
            return (
                <ChipRow
                    icon={<CheckCircle size={13} weight="fill" className="text-colorSuccess" />}
                >
                    <Text className="!text-xs">{label} connected</Text>
                </ChipRow>
            )
        }
        // Deferred by the runner (another connection was requested the same turn): the agent
        // re-asks next turn, so show a quiet note with NO Retry — a Retry here races that re-ask.
        if (deferredByRunner) {
            return (
                <ChipRow icon={<Hourglass size={13} className="text-colorTextTertiary" />}>
                    <Text type="secondary" className="!text-xs !text-colorTextTertiary">
                        Connecting {label} next…
                    </Text>
                </ChipRow>
            )
        }
        // Cancelled / timeout / failed: a Retry re-runs the OAuth fresh (the parked call already
        // resolved, so this primes the vault and flips the chip on success).
        return (
            <ChipRow icon={<Warning size={13} weight="fill" className="text-colorWarning" />}>
                <Text type="secondary" className="!text-xs">
                    Connection not completed
                </Text>
                <RetryButton onClick={() => runConnect(false)} />
            </ChipRow>
        )
    }

    // ── Error (create failed, popup blocked) on the live flow: show reason + Retry ───────────────
    if (phase === "error") {
        return (
            <ChipRow icon={<Warning size={13} weight="fill" className="text-colorError" />}>
                <Text type="danger" className="!text-xs truncate" title={errorText ?? undefined}>
                    {errorText ?? "Connection failed."}
                </Text>
                <RetryButton onClick={() => runConnect(true)} />
            </ChipRow>
        )
    }

    // ── Idle: the initial prompt ────────────────────────────────────────────────────────────────
    return (
        <ChipRow icon={<Plugs size={13} className="text-colorPrimary" />}>
            <Text className="!text-xs">Connect {label}</Text>
            <Button type="primary" onClick={() => runConnect(true)}>
                Connect
            </Button>
        </ChipRow>
    )
}

/** A compact tool-activity row, matching ToolActivity's visual language. */
const ChipRow = ({icon, children}: {icon: React.ReactNode; children: React.ReactNode}) => (
    <div className="flex min-w-0 items-center gap-2 py-1">
        <span className="shrink-0">{icon}</span>
        {children}
    </div>
)

const RetryButton = ({onClick, disabled}: {onClick: () => void; disabled?: boolean}) => (
    <Button
        type="text"
        onClick={onClick}
        disabled={disabled}
        icon={<ArrowClockwise size={13} />}
        className="!px-2"
    >
        Retry
    </Button>
)

export default ConnectToolWidget
