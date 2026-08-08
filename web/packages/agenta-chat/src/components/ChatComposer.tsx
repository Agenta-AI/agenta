/**
 * THE chat composer — one input for every surface, extracted from the desktop composer dock.
 * It owns the shared core: the lazy Lexical rich input (markdown, Enter-sends, the send button
 * that becomes Stop while streaming), the paperclip attach button, the attachments tray in the
 * input's header slot, and the paste-to-attach path. Host-specific chrome (voice mic, context
 * budget, onboarding actions) arrives through the `extraPrefix`/`trailing` slots; the
 * attachment ENGINE (staging + uploads) arrives as the `useComposerAttachments` result so
 * hosts control the rollout flag and the viewer wiring.
 */
import {Suspense, lazy, type ReactNode, type RefObject} from "react"

import {HeightCollapse} from "@agenta/ui/height-collapse"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Paperclip} from "@phosphor-icons/react"

import type {useComposerAttachments} from "../hooks/useComposerAttachments"

import ComposerAttachments from "./ComposerAttachments"

// Lexical is the heaviest dependency of the chat chunk — keep it out of the synchronous
// mount. React.lazy (not next/dynamic) so the imperative handle ref forwards.
const RichChatInput = lazy(() =>
    import("@agenta/ui/rich-chat-input").then((m) => ({default: m.RichChatInput})),
)

export interface ChatComposerProps {
    onSubmit: (text: string) => void | Promise<void>
    /** The attachment engine — staging, guardrails, uploads (see useComposerAttachments). */
    attachments: ReturnType<typeof useComposerAttachments>
    inputRef?: RefObject<RichChatInputHandle | null>
    autoFocus?: boolean
    /** Voice dictation is writing into the input (desktop). */
    dictating?: boolean
    /** Width column for the input (desktop passes its chat column; mobile's rail is outside). */
    className?: string
    disabled?: boolean
    hideSendButton?: boolean
    /** Full placeholder override; when absent, `waitingOnUser` picks the queue message. */
    placeholder?: string
    /** The run is parked on the user (HITL) — new sends will queue. */
    waitingOnUser?: boolean
    initialMarkdown?: string
    onChange?: (markdown: string) => void
    /** A run is streaming — the send button becomes Stop. */
    streaming?: boolean
    onStop?: () => void
    /** Read at event time — attachments are refused right now (a voice take in flight…). */
    attachmentsBlocked?: () => boolean
    /** The composer itself is unusable (gates the paperclip alongside `uploadsEnabled`). */
    composerDisabled?: boolean
    /** Open a viewable attachment in the host's viewer; omit to disable tile clicks. */
    onViewAttachment?: (uid: string) => void
    /** Left of the paperclip: host extras (voice mic, context budget). */
    extraPrefix?: ReactNode
    /** The input's trailing slot (onboarding actions). */
    trailing?: ReactNode
    /** Suspense fallback while the Lexical chunk hydrates (hosts pass their skeleton). */
    fallback?: ReactNode
}

export const ChatComposer = ({
    onSubmit,
    attachments,
    inputRef,
    autoFocus,
    dictating,
    className,
    disabled,
    hideSendButton,
    placeholder,
    waitingOnUser,
    initialMarkdown,
    onChange,
    streaming,
    onStop,
    attachmentsBlocked,
    composerDisabled,
    onViewAttachment,
    extraPrefix,
    trailing,
    fallback,
}: ChatComposerProps) => {
    const {
        uploadsEnabled,
        files,
        rejections,
        setRejections,
        attachmentsOpen,
        setAttachmentsOpen,
        limits,
        atMax,
        attachmentsSettled,
        uploadBlockReason,
        addFiles,
        removeFile,
        uploads,
    } = attachments

    return (
        <Suspense fallback={fallback ?? null}>
            <RichChatInput
                ref={inputRef}
                autoFocus={autoFocus}
                dictating={dictating}
                className={className}
                onSubmit={onSubmit}
                disabled={disabled}
                hideSendButton={hideSendButton}
                placeholder={
                    placeholder ??
                    (waitingOnUser
                        ? "The agent is waiting for your response — new messages will be queued"
                        : "Ask the agent… (Enter to send, ⌘/Ctrl+Enter for newline)")
                }
                initialMarkdown={initialMarkdown}
                onChange={onChange}
                onPasteFile={(pasted) => {
                    if (!attachmentsBlocked?.()) addFiles(Array.from(pasted))
                }}
                sendForceEnabled={files.length > 0 && attachmentsSettled}
                sendDisabled={files.length > 0 && !attachmentsSettled}
                sendDisabledReason={uploadBlockReason}
                streaming={streaming}
                onStop={onStop}
                prefix={
                    <div className="flex items-center gap-2">
                        {extraPrefix}
                        {/* Gate the attach button until inline file parts are supported. */}
                        <SimpleTooltip
                            title={
                                !uploadsEnabled
                                    ? "Attach files coming soon"
                                    : atMax
                                      ? `Up to ${limits.maxCount} files`
                                      : "Attach files"
                            }
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                disabled={!uploadsEnabled || composerDisabled}
                                onClick={() => setAttachmentsOpen((open) => !open)}
                                aria-label="Attach files"
                            >
                                <Paperclip size={16} />
                            </Button>
                        </SimpleTooltip>
                    </div>
                }
                header={
                    <HeightCollapse open={attachmentsOpen || files.length > 0}>
                        <ComposerAttachments
                            files={files}
                            rejections={rejections}
                            limits={limits}
                            onAdd={addFiles}
                            onRemove={removeFile}
                            onDismissRejections={() => setRejections([])}
                            onView={uploadsEnabled ? onViewAttachment : undefined}
                            onRetry={uploads.retry}
                            canRetry={uploads.canRetry}
                        />
                    </HeightCollapse>
                }
                trailing={trailing}
            />
        </Suspense>
    )
}
