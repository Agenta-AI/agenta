import {useEffect, useRef, useState} from "react"

import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {ChatActionIconButton, MetaSeparator} from "@agenta/ui/components/presentational"
import {ArrowUUpLeft, Check, Copy, TreeStructure} from "@phosphor-icons/react"
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
 * so a turn whose trace never resolved metrics, or one with no actions, leaves no dangling `·`.
 *
 * The trace button hides behind the Playground inspector preference — it is a debugging affordance,
 * not something every reader needs beside every answer. `onViewTrace` stays a prop because opening
 * the drawer lives in `@agenta/observability`, which this package does not depend on.
 */
export const TurnFooter = ({
    messageId,
    traceId,
    turnTraceId,
    isUser,
    isStreaming = false,
    usage,
    copyText,
    onRewind,
    onViewTrace,
}: {
    messageId: string
    /** The turn's own trace. Assistant turns have one; user turns do not. */
    traceId?: string | null
    /** The trace of the turn this message belongs to — the user turn's only source of time. */
    turnTraceId?: string | null
    isUser: boolean
    /** The answer is still arriving. Hides copy, which would take a half-written reply. */
    isStreaming?: boolean
    usage?: MessageUsageMetrics
    /** What the copy button puts on the clipboard. Omitted (or empty) hides the button. */
    copyText?: string
    /** Re-run from this turn. Omitted hides the button. */
    onRewind?: () => void
    /** Open the trace drawer. Omitted hides the button, as does the inspector preference being off. */
    onViewTrace?: (traceId: string) => void
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
    const hasActions = showCopy || !!onRewind || showTrace

    return (
        <>
            <TurnTimestamp messageId={messageId} traceId={traceId} turnTraceId={turnTraceId} />
            {isUser ? null : <TurnMetrics traceId={traceId} usage={usage} separator />}
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
            {onRewind ? (
                <ChatActionIconButton
                    label={isUser ? "Edit and re-run" : "Re-run this turn"}
                    icon={<ArrowUUpLeft size={12} />}
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
