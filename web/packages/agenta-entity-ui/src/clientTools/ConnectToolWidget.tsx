/**
 * Connect widget — the `request_connection` / `render.kind: "connect"` client tool (#4920).
 *
 * The agent asked for a connection it lacks (e.g. GitHub). While the call is PARKED, this inline
 * row is a passive marker only — the actions (Connect / Not now / Cancel) live in the
 * InteractionDock in the composer region, mirroring ApprovalDock's "dock acts, inline marks"
 * contract, so the paused run can never scroll out of reach and always has an escape hatch.
 *
 * After the call settles this row owns the result UX (U1) — an inline status chip in the same
 * visual language as approve/deny: "GitHub connected" ✓, or "Connection not completed" + Retry
 * (which re-runs the OAuth via the shared `useConnectFlow`, priming the vault for the agent's
 * re-ask — the settled part itself can't be re-resolved).
 */
import type {ClientToolWidgetProps as ClientToolHandlerProps} from "@agenta/shared/clientTools"
import {Button} from "@agenta/ui/ui"
import {ArrowClockwise, Hourglass, Spinner} from "@phosphor-icons/react"

import {IntegrationTile} from "./IntegrationTile"
import {GENERIC_CONNECT_ERROR, useConnectFlow, type ConnectOutput} from "./useConnectFlow"

/**
 * The runner parks only ONE interaction per turn; a second `request_connection` in the same step is
 * force-settled with this sentinel and RE-REQUESTED next turn (services/runner otel.ts
 * `TOOL_NOT_EXECUTED_PAUSED`). It is a deferral, not a failure — render it quietly with no Retry, so
 * the user waits for the agent's re-ask instead of starting a flow that races it.
 */
const DEFERRED_SENTINEL = "DEFERRED_NOT_EXECUTED"

/** Non-error terminal reasons (see `ConnectOutput.reason`): render generic wording for
 * these; any other `reason` is a real failure message and must be shown verbatim — a
 * create failure was previously settling silently with no error surfaced at all. */
const KNOWN_CONNECT_REASONS = new Set(["declined", "cancelled", "timeout"])

const ConnectToolWidget = ({meta, settle}: ClientToolHandlerProps) => {
    const {
        label,
        logo,
        phase,
        errorText,
        outcome,
        manuallyConnected,
        modeResolving,
        runConnect,
        cancel,
    } = useConnectFlow(meta, settle)

    // A runner-deferred sibling settles as an error carrying the deferral sentinel (not a real
    // connection failure); see DEFERRED_SENTINEL.
    const partErrorText = (meta.part as {errorText?: unknown}).errorText
    const deferredByRunner =
        meta.state === "output-error" &&
        typeof partErrorText === "string" &&
        partErrorText.startsWith(DEFERRED_SENTINEL)

    // ── Connecting: a post-settle manual retry's popup is open ───────────────────────────────────
    if (phase === "connecting") {
        return (
            <ChipRow icon={<Spinner size={13} className="animate-spin text-colorPrimary" />}>
                <span className="text-xs text-colorText">Connecting {label}…</span>
                <Button variant="ghost" size="sm" onClick={cancel} className="px-2">
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
                <ChipRow icon={<IntegrationTile label={label} logo={logo} size={16} />}>
                    <span className="truncate text-xs text-colorText">{label} connected</span>
                </ChipRow>
            )
        }
        // Deferred by the runner (another connection was requested the same turn): the agent
        // re-asks next turn, so show a quiet note with NO Retry — a Retry here races that re-ask.
        if (deferredByRunner) {
            return (
                <ChipRow icon={<Hourglass size={13} className="text-colorTextTertiary" />}>
                    <span className="text-xs text-colorTextTertiary">Connecting {label} next…</span>
                </ChipRow>
            )
        }
        // The tile says WHICH tool and the wording says what happened, so the row stays in the
        // neutral tone — no glyph or colour competing with the brand mark.
        // "declined" is the user's own "Not now", so it must NOT read as a failure; cancelled and
        // timeout did fail to reach a connection. Both stay in the quiet tint — expected, not
        // errors. Any other reason is the create call's own failure message and must be
        // shown, not swallowed behind the same generic text (it previously was).
        // A remounted part (after a reload) has no local `outcome` and usually no `meta.output`;
        // its failure text survives only on the part itself.
        const reason =
            outcome?.reason ??
            output.reason ??
            (typeof partErrorText === "string" && !partErrorText.startsWith(DEFERRED_SENTINEL)
                ? partErrorText
                : undefined)
        const failureDetail =
            typeof reason === "string" && reason && !KNOWN_CONNECT_REASONS.has(reason)
                ? reason
                : undefined
        return (
            <ChipRow icon={<IntegrationTile label={label} logo={logo} size={16} />}>
                <span className="shrink-0 text-xs text-colorText">{label}</span>
                <span className="truncate text-xs text-colorText" title={failureDetail}>
                    {failureDetail ??
                        (reason === "declined" ? "not connected" : "connection failed")}
                </span>
                <RetryButton onClick={() => runConnect(false)} disabled={modeResolving} />
            </ChipRow>
        )
    }

    // ── Error on a manual retry (create failed, popup blocked): show reason + Retry ──────────────
    if (phase === "error") {
        // The generic fallback would read "Gmail Connection failed. Please try again." after the
        // name; only a real backend detail earns the space.
        const errorDetail = errorText && errorText !== GENERIC_CONNECT_ERROR ? errorText : undefined
        return (
            <ChipRow icon={<IntegrationTile label={label} logo={logo} size={16} />}>
                <span className="shrink-0 text-xs text-colorText">{label}</span>
                <span className="truncate text-xs text-colorText" title={errorDetail}>
                    {errorDetail ?? "connection failed"}
                </span>
                <RetryButton onClick={() => runConnect(false)} disabled={modeResolving} />
            </ChipRow>
        )
    }

    // ── Pending: passive marker — the connect dock (above the composer) owns the actions ─────────
    // The brand mark, not a generic plug: the dock identifies each queued connection the same way.
    // The dock card's ask, trimmed to its first clause plus the pointer — the row marks WHICH tool
    // and WHERE to answer; the card below carries the reason. One span, not name + tail: the row's
    // flex gap would split the phrase and leave "below" reading as an orphan.
    return (
        <ChipRow icon={<IntegrationTile label={label} logo={logo} size={16} />}>
            <span className="truncate text-xs text-colorText">Connect to {label} below</span>
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
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} className="px-2">
        <ArrowClockwise size={13} />
        Retry
    </Button>
)

export default ConnectToolWidget
