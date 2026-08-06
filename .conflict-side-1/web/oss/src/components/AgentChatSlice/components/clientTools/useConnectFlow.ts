/**
 * The Agenta OAuth connect flow for a `request_connection` client tool (#4920), extracted from
 * ConnectToolWidget so two surfaces share ONE implementation without double-settling:
 *  - the InteractionDock card (composer region) owns the LIVE parked call's actions — Connect,
 *    "Not now" (decline), Cancel — mirroring ApprovalDock's "dock acts, inline marks" contract;
 *  - the inline transcript chip keeps the post-settle states (result chip + Retry, which re-runs
 *    the OAuth with `settleParkedCall=false` to prime the vault for the agent's re-ask).
 *
 * It runs the existing connection machinery (`useToolsConnections` → `POST /tools/connections/`,
 * then a popup on the returned `redirect_url`) and settles the parked call with a **reference,
 * never a secret**: the runner re-resolves the credential from the project vault on resume.
 *
 * Security (hard requirement, design §"Security"): the popup posts back a `tools:oauth:complete`
 * message; we trust it ONLY when `event.origin` equals the Agenta API origin (the callback page's
 * origin) and the payload shape matches. Everything else is dropped. The callback also tags the
 * message with the connection's `slug`/`integration`, so when several connect flows are live at
 * once each settles only on its OWN completion (never on a sibling's).
 *
 * Settle on every terminal path (design §"Settle on every path"), so the run never hangs:
 *   success → {connected:true, integration, slug} · decline → {connected:false, reason:"declined"}
 *   · cancel/abandon → {connected:false, reason:"cancelled"} · timeout → {connected:false,
 *   reason:"timeout"} · failure → errorText.
 *
 * Two instances can be mounted for the SAME parked call (dock + inline marker). `meta.settled`
 * guards every live-settle path in addition to the per-instance `settledRef`, so an instance that
 * didn't perform the settle can never fire a second `addToolOutput` for it.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {useToolsConnections} from "../../../pages/settings/Tools/hooks/useToolsConnections"

import type {ClientToolMeta, SettleClientTool} from "./types"

/**
 * No terminal signal within this bound settles the call as a timeout so the run can't wait forever.
 * Armed only once the popup is open (the user is mid-flow). 3 minutes covers a real OAuth consent.
 * NOTE for Mahmoud: confirm the bound — open question §"abandon timeout".
 */
const CONNECT_TIMEOUT_MS = 180_000
/** Popup-closed poll cadence, matching the existing ConnectModal. */
const POPUP_POLL_MS = 1000

/** The settled call's reference shape (what the runner re-resolves against). */
export interface ConnectOutput {
    connected?: boolean
    integration?: string
    slug?: string
    reason?: string
}

export type ConnectPhase = "idle" | "connecting" | "error"

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

export const useConnectFlow = (meta: ClientToolMeta, settle: SettleClientTool, active = true) => {
    const input = (meta.input ?? {}) as Record<string, unknown>
    const integration = typeof input.integration === "string" ? input.integration : ""
    // Connection slug: the call may pin one; default to the integration key. The output carries it
    // back as the reference the runner re-resolves.
    const slug =
        typeof input.slug === "string" && input.slug ? input.slug : integration || "default"
    const mode = input.mode === "api_key" ? "api_key" : "oauth"
    const label = prettyIntegration(integration)
    // A window name UNIQUE to this parked call. Several connect flows can be live at once; a shared
    // name makes the second `window.open` reuse the first's popup, so the second flow's
    // `tools:oauth:complete` message never reaches this flow and its popup-closed poll settles it
    // as cancelled — "connected but shows failed". The tool-call id is unique per parked call.
    const oauthWindowName = `tools_oauth_${meta.toolCallId}`

    const {handleCreate, invalidate} = useToolsConnections(integration)

    const [phase, setPhase] = useState<ConnectPhase>("idle")
    const [errorText, setErrorText] = useState<string | null>(null)
    // A retry started AFTER the parked call already settled (as a failure) succeeded. The settled
    // part can't be re-resolved, but the connection now exists in the vault, so we flip the chip to
    // "connected" — the agent's re-ask resolves cleanly on its next turn.
    const [manuallyConnected, setManuallyConnected] = useState(false)
    // The live flow's terminal result, held locally so the chip paints the instant we settle —
    // `meta.settled` only flips a render later (after `addToolOutput` propagates), and without this
    // the surface would stay on "Connecting…" until then.
    const [outcome, setOutcome] = useState<{connected: boolean} | null>(null)

    // One-shot guard so THIS instance settles the parked call at most once, plus shared cleanup for
    // the running popup's listener/poll/timeout. `meta.settled` covers the OTHER instance's settle.
    const settledRef = useRef(false)
    const activeRef = useRef(active)
    activeRef.current = active
    const popupRef = useRef<Window | null>(null)
    const cleanupRef = useRef<(() => void) | null>(null)

    const teardown = useCallback(() => {
        cleanupRef.current?.()
        cleanupRef.current = null
        popupRef.current = null
    }, [])

    // Settle the parked part exactly once (success/decline/cancel/timeout/failure route through here).
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

    useEffect(() => {
        if (!active) {
            teardown()
            setPhase("idle")
        }
        return () => teardown()
    }, [active, teardown])

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
            if (settleParkedCall && (!activeRef.current || settledRef.current || meta.settled))
                return
            setErrorText(null)
            setPhase("connecting")
            try {
                const result = await handleCreate({slug, name: slug, mode})
                if (settleParkedCall && !activeRef.current) return
                const redirectUrl =
                    typeof result.connection?.data?.redirect_url === "string"
                        ? result.connection.data.redirect_url
                        : undefined

                const onSuccess = () => {
                    if (settleParkedCall && !activeRef.current) return
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
                    oauthWindowName,
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
                    if (!apiOrigin || event.origin !== apiOrigin) return
                    const data = event.data as {
                        type?: unknown
                        slug?: unknown
                        integration?: unknown
                    } | null
                    if (!data || data.type !== "tools:oauth:complete") return
                    // Several connect flows can be live at once (an agent may ask for
                    // multiple connections in one turn). The callback tags the completion with
                    // its connection identity, so a flow settles ONLY on its own completion —
                    // otherwise the first finished flow would mark every open one connected.
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
                    if (settleParkedCall && !activeRef.current) return
                    if (settleParkedCall)
                        finish({connected: false, integration, slug, reason: "cancelled"})
                    else setPhase("idle")
                }, POPUP_POLL_MS)

                const timeout = window.setTimeout(() => {
                    if (succeeded) return
                    teardown()
                    if (settleParkedCall && !activeRef.current) return
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
                if (settleParkedCall && !activeRef.current) return
                const message = err instanceof Error ? err.message : "Connection failed."
                // A create failure is terminal for the parked call: settle so the run resumes; for a
                // manual retry just surface the reason with another Retry.
                setPhase("error")
                setErrorText(message)
                if (settleParkedCall) finish({connected: false, integration, slug, reason: message})
            }
        },
        [
            phase,
            meta.settled,
            handleCreate,
            slug,
            mode,
            invalidate,
            finish,
            teardown,
            integration,
            oauthWindowName,
        ],
    )

    // Explicit cancel while the popup is open: settle the parked call as cancelled (or, when the
    // call is already settled — a manual retry — just stop).
    const cancel = useCallback(() => {
        teardown()
        if (!settledRef.current && !meta.settled)
            finish({connected: false, integration, slug, reason: "cancelled"})
        else setPhase("idle")
    }, [finish, teardown, integration, slug, meta.settled])

    // The user's "Not now": a structured refusal (NOT an error), so the run resumes and the agent
    // can respond gracefully / offer an alternative. Distinct from "cancelled" (abandoned popup) so
    // the agent can tell an explicit decline from a mishap.
    const decline = useCallback(() => {
        if (settledRef.current || meta.settled) return
        finish({connected: false, integration, slug, reason: "declined"})
    }, [finish, integration, slug, meta.settled])

    return {
        integration,
        slug,
        label,
        phase,
        errorText,
        outcome,
        manuallyConnected,
        runConnect,
        cancel,
        decline,
    }
}
