import {useEffect, useRef, useState} from "react"

import type {TurnFigures} from "@agenta/entities/session"
import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {ChatActionIconButton, MetaSeparator} from "@agenta/ui/components/presentational"
import {ArrowClockwise, Check, Copy, TreeStructure} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import type {MessageUsageMetrics} from "../assets"

import {TurnMetrics} from "./TurnMetrics"
import {TurnTimestamp} from "./TurnTimestamp"

/**
 * A turn's meta line: when it ran, what it cost, and what you can do with it.
 *
 * One component for both apps. It used to be assembled by hand in `web/oss` and again in
 * `web/mobile`, and the two copies drifted on icons, on clipboard handling, and on which buttons
 * appeared — so the footer lives here and each app only supplies the parts it derives differently.
 *
 * Each segment owns the separator BEFORE it, and only draws it when it renders something itself —
 * so a turn with no known figures, or one with no actions, leaves no dangling `·`.
 *
 * The trace button hides behind the Playground inspector preference — it is a debugging affordance,
 * not something every reader needs beside every answer. `onViewTrace` stays a prop because opening
 * the drawer lives in `@agenta/observability`, which this package does not depend on.
 */
export const TurnFooter = ({
    messageId,
    traceId,
    isUser,
    isStreaming = false,
    usage,
    sessionTurnFigures,
    sessionTurnStartedAt,
    sessionTurnsPending = false,
    copyText,
    onRewind,
    onViewTrace,
    metrics,
    onRetry,
}: {
    messageId: string
    /** The turn's own trace, for the trace button only: the footer reads no trace. */
    traceId?: string | null
    isUser: boolean
    /** The answer is still arriving. Hides copy, which would take a half-written reply. */
    isStreaming?: boolean
    usage?: MessageUsageMetrics
    /** The figures stored on the session turn; a settled turn shows only these. */
    sessionTurnFigures?: TurnFigures
    /** The start of the session turn (a user turn: the session turn it started). */
    sessionTurnStartedAt?: string | null
    /** The session's turns are still loading. */
    sessionTurnsPending?: boolean
    /** What the copy button puts on the clipboard. Omitted (or empty) hides the button. */
    copyText?: string
    /** Re-run from this turn. Omitted hides the button. */
    onRewind?: () => void
    /** Open the trace drawer. Omitted hides the button, as does the inspector preference being off. */
    onViewTrace?: (traceId: string) => void
    /** Which figures the meta line draws; all by default. See `TurnMetrics`. */
    metrics?: ("latency" | "tokens" | "cost")[]
    /** Send the failed turn again. Omitted hides the button. */
    onRetry?: () => void
}) => {
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const [copied, setCopied] = useState(false)
    const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(
        () => () => {
            if (copyResetRef.current) clearTimeout(copyResetRef.current)
        },
        [],
    )

    const handleCopy = async () => {
        if (!copyText) return
        try {
            await navigator.clipboard.writeText(copyText)
            setCopied(true)
            if (copyResetRef.current) clearTimeout(copyResetRef.current)
            copyResetRef.current = setTimeout(() => setCopied(false), 1500)
        } catch {
            // Clipboard denied (insecure origin, or the user said no) — nothing to recover.
            setCopied(false)
        }
    }

    const showTrace = !!traceId && !!onViewTrace && inspectorEnabled
    const showCopy = !!copyText && !isStreaming
    const hasActions = showCopy || !!onRewind || showTrace || !!onRetry

    return (
        <>
            <TurnTimestamp
                messageId={messageId}
                startedAt={sessionTurnStartedAt}
                pending={sessionTurnsPending}
            />
            {isUser ? null : (
                <TurnMetrics
                    usage={usage}
                    sessionTurnFigures={sessionTurnFigures}
                    isStreaming={isStreaming}
                    separator
                    show={metrics}
                />
            )}
            {hasActions ? <MetaSeparator className="first:hidden" /> : null}
            {showCopy ? (
                <ChatActionIconButton
                    label={copied ? "Copied" : "Copy"}
                    icon={copied ? <Check size={12} /> : <Copy size={12} />}
                    onClick={handleCopy}
                    // The check that replaces the icon is the feedback; a tooltip only repeats it.
                    tooltip={false}
                />
            ) : null}
            {onRetry ? (
                <ChatActionIconButton
                    label="Try again"
                    icon={<ArrowClockwise size={12} />}
                    onClick={onRetry}
                />
            ) : null}
            {onRewind ? (
                <ChatActionIconButton
                    label={isUser ? "Edit and re-run" : "Re-run this turn"}
                    icon={<ArrowClockwise size={12} />}
                    onClick={onRewind}
                />
            ) : null}
            {showTrace ? (
                <ChatActionIconButton
                    label="View trace"
                    icon={<TreeStructure size={12} />}
                    onClick={() => onViewTrace?.(traceId as string)}
                />
            ) : null}
        </>
    )
}
