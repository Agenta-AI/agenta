import {useState} from "react"

import {Check, Copy, Trash} from "@phosphor-icons/react"
import {Button, Input, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {SessionInspectorButton} from "@/oss/components/SessionInspector"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

import {
    deleteSessionAtomFamily,
    firstUserText,
    renameSessionAtomFamily,
    sessionMessagesAtom,
    sessionStatusAtomFamily,
    timeAgo,
    type SessionRunStatus,
} from "../AgentChatSlice/state/sessions"

const STATUS_LABEL: Record<
    SessionRunStatus,
    {label: string; text: string; dot: string; pulse: boolean}
> = {
    running: {label: "Running", text: "text-colorInfo", dot: "bg-colorInfo", pulse: true},
    awaiting: {
        label: "Waiting for approval",
        text: "text-colorWarning",
        dot: "bg-colorWarning",
        pulse: true,
    },
    error: {label: "Last run failed", text: "text-colorError", dot: "bg-colorError", pulse: false},
    idle: {
        label: "Idle",
        text: "text-colorTextSecondary",
        dot: "bg-colorTextQuaternary",
        pulse: false,
    },
}

const FieldLabel = ({children}: {children: React.ReactNode}) => (
    <div className="mb-1.5 text-[11px] font-semibold capitalize text-colorTextTertiary">
        {children}
    </div>
)

interface SessionIdentityCardProps {
    sessionId: string
    /** Chat scope key (see useChatScopeKey) — rename/delete are scoped to it. */
    scope: string
    /** Current resolved label (title, or the derived fallback). */
    label: string
    createdAt?: number
    /** Close the popover (after a delete removes the session). */
    onClose?: () => void
}

/**
 * A session's context card — title edits inline (saved on blur/Enter), with the run status, the
 * opening message (so an untitled chat is identifiable), and activity alongside. The pen on a
 * session tab opens this; the tab's double-click remains the quick inline rename.
 */
const SessionIdentityCard = ({
    sessionId,
    scope,
    label,
    createdAt,
    onClose,
}: SessionIdentityCardProps) => {
    const status = useAtomValue(sessionStatusAtomFamily(sessionId))
    const messages = useAtomValue(sessionMessagesAtom)[sessionId]
    const renameSession = useSetAtom(renameSessionAtomFamily(scope))
    const deleteSession = useSetAtom(deleteSessionAtomFamily(scope))
    const [copied, setCopied] = useState(false)

    const preview = firstUserText(messages)
    const count = messages?.length ?? 0
    const meta = STATUS_LABEL[status]

    const copyId = () => {
        copyToClipboard(sessionId, false)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
    }

    const commitTitle = (value: string) => {
        const next = value.trim()
        if (next !== label) renameSession({id: sessionId, title: next})
    }

    return (
        <div className="flex flex-col gap-3.5">
            <div>
                <FieldLabel>Session title</FieldLabel>
                <Input
                    defaultValue={label}
                    onPressEnter={(e) => e.currentTarget.blur()}
                    onBlur={(e) => commitTitle(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="!text-xs"
                />
            </div>

            <div className="flex items-center gap-2 text-xs">
                <span className="relative flex h-2 w-2 shrink-0">
                    {meta.pulse && (
                        <span
                            className={clsx(
                                "absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping",
                                meta.dot,
                            )}
                        />
                    )}
                    <span className={clsx("relative inline-flex h-2 w-2 rounded-full", meta.dot)} />
                </span>
                <span className={`font-medium ${meta.text}`}>{meta.label}</span>
            </div>

            {preview && (
                <div>
                    <FieldLabel>Opening message</FieldLabel>
                    <div className="line-clamp-2 break-words rounded-lg border-0 border-l-2 border-solid border-[var(--ag-c-13C2C2)] bg-colorFillQuaternary px-2.5 py-2 text-[13px] leading-snug text-colorTextSecondary">
                        {preview}
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-colorTextSecondary">
                <span>
                    {count} message{count === 1 ? "" : "s"}
                </span>
                {timeAgo(createdAt) && (
                    <>
                        <span className="text-colorTextTertiary">·</span>
                        <span>created {timeAgo(createdAt)}</span>
                    </>
                )}
            </div>

            <div className="flex items-center gap-1 border-0 border-t border-solid border-colorBorderSecondary pt-3">
                <span className="font-mono text-[11px] text-colorTextTertiary">
                    ID {sessionId.slice(0, 8)}…
                </span>
                <Tooltip title="Copy session ID">
                    <Button
                        type="text"
                        size="small"
                        aria-label="Copy session ID"
                        icon={copied ? <Check size={13} /> : <Copy size={13} />}
                        onClick={copyId}
                        className="!h-6 !w-6 !min-w-0 !p-0"
                    />
                </Tooltip>
                <span className="flex-1" />
                <SessionInspectorButton sessionId={sessionId} onClick={onClose} />
                <Tooltip title="Delete session">
                    <Button
                        type="text"
                        size="small"
                        danger
                        aria-label="Delete session"
                        icon={<Trash size={14} />}
                        onClick={() => {
                            deleteSession(sessionId)
                            onClose?.()
                        }}
                        className="!h-6 !w-6 !min-w-0 !p-0"
                    />
                </Tooltip>
            </div>
        </div>
    )
}

export default SessionIdentityCard
