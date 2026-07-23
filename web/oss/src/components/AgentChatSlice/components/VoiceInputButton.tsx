import {useEffect, useRef, type RefObject} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {CaretDown, Microphone, Waveform} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip, type MenuProps} from "antd"
import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {useVoiceInput} from "../hooks/useVoiceInput"

/**
 * Voice control for the composer, two modes (the last choice sticks):
 *  - "transcribe" — dictate speech to text, streamed live into the editor (Web Speech API).
 *  - "audio" — record a voice message; the parent owns the recorder and renders the recording
 *    takeover, so here the mic only starts it (`onStartAudio`).
 * Renders nothing where neither engine is supported; offers only the supported modes.
 */

type VoiceMode = "transcribe" | "audio"

const voiceModeAtom = atomWithStorage<VoiceMode>("agenta:agent-chat:voice-mode", "audio")

const MODE_LABEL: Record<VoiceMode, string> = {
    audio: "Voice message",
    transcribe: "Voice to text",
}

/** Verbs, so the tooltip says what pressing it will do — not just which mode is selected. */
const MODE_HINT: Record<VoiceMode, string> = {
    audio: "Record a voice message",
    transcribe: "Dictate into the message",
}

/** Each mode carries its own icon, so the button shows which is active and switching visibly
 * changes the control. Both stay voice-y — the difference is what comes OUT: a waveform for an
 * audio clip, and the microphone every phone keyboard uses for dictation. */
const modeIcon = (mode: VoiceMode, filled = false) =>
    mode === "audio" ? (
        <Waveform size={16} weight={filled ? "fill" : "regular"} />
    ) : (
        <Microphone size={16} weight={filled ? "fill" : "regular"} />
    )

const VoiceInputButton = ({
    inputRef,
    onStartAudio,
    audioSupported,
    audioPending,
    attachmentsFull,
    onDictationError,
    onDictatingChange,
    disabled,
}: {
    inputRef: RefObject<RichChatInputHandle | null>
    onStartAudio: () => void
    audioSupported: boolean
    /** Report dictation failures upward so they surface in the shared mic notice rather than a
     * tooltip nobody hovers. The transcript itself stays local — it changes far too often to lift. */
    onDictationError: (message: string | null) => void
    /** Dictation locks the editor while it runs, which the composer owns. */
    onDictatingChange: (active: boolean) => void
    /** Tray is at its file limit. A voice message attaches like any file, so recording one now
     * would be rejected on attach — i.e. the take would be destroyed after the fact. */
    attachmentsFull: boolean
    /** Awaiting the browser's mic prompt — shown here rather than as a composer takeover, since
     * the prompt is the browser's own UI and a page cannot dismiss it. */
    audioPending: boolean
    disabled?: boolean
}) => {
    const [mode, setMode] = useAtom(voiceModeAtom)
    const transcribe = useVoiceInput()

    useEffect(() => {
        onDictationError(transcribe.error)
    }, [transcribe.error, onDictationError])

    // Push the transcript through the editor's dictation session: committed words land as normal
    // text, the provisional tail is styled as unsettled. No document rewrite, so the undo history
    // and anything already typed survive.
    useEffect(() => {
        if (!transcribe.recording) return
        inputRef.current?.updateDictation(transcribe.finalText, transcribe.interimText)
    }, [transcribe.recording, transcribe.finalText, transcribe.interimText, inputRef])

    // Settle the editor session once the recogniser actually stops (it emits a last final result
    // on the way out, so ending earlier would drop those words).
    const wasRecording = useRef(false)
    useEffect(() => {
        if (wasRecording.current && !transcribe.recording) {
            inputRef.current?.endDictation()
            inputRef.current?.focus()
        }
        wasRecording.current = transcribe.recording
        onDictatingChange(transcribe.recording)
    }, [transcribe.recording, inputRef, onDictatingChange])

    // Primary action first: a voice message is the default; dictation is the alternative.
    const modes: {key: VoiceMode; supported: boolean}[] = [
        {key: "audio", supported: audioSupported},
        {key: "transcribe", supported: transcribe.supported},
    ]
    const available = modes.filter((m) => m.supported)
    if (!available.length) return null
    const effective: VoiceMode = available.some((m) => m.key === mode) ? mode : available[0].key

    // The mic only reflects a recording state for transcribe; audio recording is the parent's
    // takeover bar (which covers this button while active).
    const dictating = effective === "transcribe" && transcribe.recording

    const toggle = () => {
        if (effective === "audio") {
            onStartAudio()
            return
        }
        if (transcribe.recording) {
            transcribe.stop()
        } else {
            inputRef.current?.beginDictation()
            transcribe.start()
        }
    }

    // Icons in the menu too, so the mapping between a mode and the button's icon is taught here.
    const menuItems: MenuProps["items"] = available.map((m) => ({
        key: m.key,
        label: MODE_LABEL[m.key],
        icon: modeIcon(m.key),
    }))

    // Dictation writes into the editor, so it is unaffected by the attachment limit.
    const audioBlocked = effective === "audio" && attachmentsFull

    const title = audioPending
        ? "Waiting for your browser's microphone prompt…"
        : audioBlocked
          ? "Attachment limit reached — remove a file to record a voice message"
          : dictating
            ? "Stop dictation"
            : MODE_HINT[effective]

    const highlighted = dictating || audioPending

    return (
        <div className="flex items-center">
            <Tooltip title={title}>
                <Button
                    type="text"
                    icon={modeIcon(effective, highlighted)}
                    onClick={toggle}
                    // A second press while the prompt is open would only queue another request.
                    disabled={disabled || audioPending || audioBlocked}
                    aria-label={dictating ? "Stop voice input" : title}
                    className={
                        dictating
                            ? "!text-colorError animate-pulse"
                            : audioPending
                              ? "animate-pulse"
                              : undefined
                    }
                />
            </Tooltip>
            {available.length > 1 && !dictating && !audioPending ? (
                <Dropdown
                    trigger={["click"]}
                    disabled={disabled}
                    menu={{
                        items: menuItems,
                        selectable: true,
                        selectedKeys: [effective],
                        onClick: ({key}) => setMode(key as VoiceMode),
                    }}
                >
                    <Button
                        type="text"
                        icon={<CaretDown size={12} />}
                        aria-label="Voice input mode"
                        className="!px-1"
                    />
                </Dropdown>
            ) : null}
        </div>
    )
}

export default VoiceInputButton
