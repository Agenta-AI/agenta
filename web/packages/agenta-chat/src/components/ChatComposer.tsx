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
import type {RichChatInputHandle, SlashCommandSection} from "@agenta/ui/rich-chat-input"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Paperclip} from "@phosphor-icons/react"

import type {useComposerAttachments} from "../hooks/useComposerAttachments"
import {useHardwareKeyboard} from "../hooks/useHardwareKeyboard"

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
    /**
     * Force the Send/Newline hints on or off. Left unset they follow the device: shown wherever
     * there is a keyboard to press them with, hidden on a touch-only screen.
     */
    hideShortcutHints?: boolean
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
    /** The `/` palette's sections. Omit where the surface has no commands. */
    slashCommands?: SlashCommandSection[]
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
    hideShortcutHints,
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
    slashCommands,
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

    // Keyboard affordances are only worth their width where there is a keyboard. On a phone the
    // "Enter to send" hint and the `⌘ ↵` chips name keys the user has no way to press, and they
    // take room from a placeholder that is already tight. `isMacPlatform` reads the UA, so a real
    // iPhone was being shown the `⌘` variant specifically.
    const hasKeyboard = useHardwareKeyboard()

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
                hideShortcutHints={hideShortcutHints ?? !hasKeyboard}
                placeholder={
                    placeholder ??
                    (waitingOnUser
                        ? // The parked interaction is docked directly above, so point at it rather
                          // than describing the wait in the abstract.
                          "Answer above, or type to queue a message"
                        : hasKeyboard
                          ? "Ask the agent… (Enter to send, ⌘/Ctrl+Enter for newline)"
                          : "Ask the agent…")
                }
                initialMarkdown={initialMarkdown}
                slashCommands={slashCommands}
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
