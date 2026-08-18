/**
 * Connect widget — the `request_connection` / `render.kind: "connect"` client tool (#4920).
 *
 * The agent asked for a connection it lacks (e.g. GitHub). While the call is PARKED, this inline
 * row owns the Connect / Not now actions. The InteractionDock remains a shortcut back to it.
 *
 * After the call settles this row owns the result UX (U1) — an inline status chip in the same
 * visual language as approve/deny: "GitHub connected" ✓, or "Connection not completed" + Retry
 * (which re-runs the OAuth via the shared `useConnectFlow`, priming the vault for the agent's
 * re-ask — the settled part itself can't be re-resolved).
 */
import {isInteractionEndedOutput} from "@agenta/shared/clientTools"
import {DEFERRED_NOT_EXECUTED_PREFIX} from "@agenta/shared/utils"
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
import {settledFailureChip, useConnectFlow, type ConnectOutput} from "./useConnectFlow"

const {Text} = Typography

const ConnectToolWidget = ({meta, settle}: ClientToolHandlerProps) => {
    const {
        label,
        phase,
        errorText,
        errorRetryable,
        outcome,
        manuallyConnected,
        modeResolving,
        runConnect,
        cancel,
        decline,
    } = useConnectFlow(meta, settle)

    // A runner-deferred sibling settles as an error carrying the deferral sentinel (not a real
    // connection failure); the agent RE-REQUESTS it next turn, so render quietly with no Retry.
    const partErrorText = (meta.part as {errorText?: unknown}).errorText
    const deferredByRunner =
        meta.state === "output-error" &&
        typeof partErrorText === "string" &&
        partErrorText.startsWith(DEFERRED_NOT_EXECUTED_PREFIX)

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
        if (isInteractionEndedOutput(meta.output)) {
            return (
                <ChipRow icon={<Plugs size={13} className="text-colorTextTertiary" />}>
                    <Text type="secondary" className="!text-xs !text-colorTextTertiary">
                        Connection request ended
                    </Text>
                </ChipRow>
            )
        }
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
        // Declined / cancelled / timeout get quiet generic wording; any other reason is the create
        // call's own failure message and is shown verbatim. This branch is the one a parked card
        // takes, the only one that survives a reload, and the only one a post-settle retry reaches.
        const {failureDetail, retryable: settledRetryable} = settledFailureChip(outcome, output)
        return (
            <ChipRow
                icon={
                    <Warning
                        size={13}
                        weight="fill"
                        className={failureDetail ? "text-colorError" : "text-colorWarning"}
                    />
                }
            >
                <Text
                    type={failureDetail ? "danger" : "secondary"}
                    className="!text-xs truncate"
                    title={failureDetail}
                >
                    {failureDetail ?? "Connection not completed"}
                </Text>
                {/* No Retry for a duplicate: repeating the create can only 409 again, and the call
                    is already settled so there is nothing else to act on. */}
                {settledRetryable ? (
                    <RetryButton onClick={() => runConnect(false)} disabled={modeResolving} />
                ) : null}
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
                <div className="ml-auto flex items-center gap-1.5">
                    <Button type="text" size="small" onClick={decline}>
                        Not now
                    </Button>
                    {/* A duplicate-connection failure can only repeat, so Retry is not offered. */}
                    {errorRetryable ? (
                        <RetryButton onClick={() => runConnect(false)} disabled={modeResolving} />
                    ) : null}
                </div>
            </ChipRow>
        )
    }

    return (
        <ChipRow icon={<Plugs size={13} className="text-colorPrimary" />}>
            <Text className="!text-xs">Connect {label}</Text>
            <div className="ml-auto flex items-center gap-1.5">
                <Button type="text" size="small" onClick={decline}>
                    Not now
                </Button>
                <Button
                    type="primary"
                    size="small"
                    disabled={modeResolving}
                    title={modeResolving ? "Checking how this toolkit connects…" : undefined}
                    onClick={() => runConnect(true)}
                >
                    Connect {label}
                </Button>
            </div>
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
