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
import {
    ArrowClockwise,
    CheckCircle,
    Hourglass,
    Plugs,
    Spinner,
    Warning,
} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

import type {ClientToolHandlerProps} from "./types"
import {useConnectFlow, type ConnectOutput} from "./useConnectFlow"

const {Text} = Typography

/**
 * The runner parks only ONE interaction per turn; a second `request_connection` in the same step is
 * force-settled with this sentinel and RE-REQUESTED next turn (services/runner otel.ts
 * `TOOL_NOT_EXECUTED_PAUSED`). It is a deferral, not a failure — render it quietly with no Retry, so
 * the user waits for the agent's re-ask instead of starting a flow that races it.
 */
const DEFERRED_SENTINEL = "DEFERRED_NOT_EXECUTED"

const ConnectToolWidget = ({meta, settle}: ClientToolHandlerProps) => {
    const {label, phase, errorText, outcome, manuallyConnected, runConnect, cancel} =
        useConnectFlow(meta, settle)

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
        // Declined / cancelled / timeout / failed: a Retry re-runs the OAuth fresh (the parked call
        // already resolved, so this primes the vault and flips the chip on success).
        return (
            <ChipRow icon={<Warning size={13} weight="fill" className="text-colorWarning" />}>
                <Text type="secondary" className="!text-xs">
                    Connection not completed
                </Text>
                <RetryButton onClick={() => runConnect(false)} />
            </ChipRow>
        )
    }

    // ── Error on a manual retry (create failed, popup blocked): show reason + Retry ──────────────
    if (phase === "error") {
        return (
            <ChipRow icon={<Warning size={13} weight="fill" className="text-colorError" />}>
                <Text type="danger" className="!text-xs truncate" title={errorText ?? undefined}>
                    {errorText ?? "Connection failed."}
                </Text>
                <RetryButton onClick={() => runConnect(false)} />
            </ChipRow>
        )
    }

    // ── Pending: passive marker — the InteractionDock (above the composer) owns the actions ──────
    return (
        <ChipRow icon={<Plugs size={13} className="text-colorPrimary" />}>
            <Text className="!text-xs">Connect {label}</Text>
            <Text type="secondary" className="!text-xs !text-colorTextTertiary">
                waiting for your response below
            </Text>
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
