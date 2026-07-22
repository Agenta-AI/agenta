import {useEffect, useRef, type RefObject} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {CaretDown, Microphone} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip, type MenuProps} from "antd"
import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {useAudioRecorder} from "../hooks/useAudioRecorder"
import {useVoiceInput} from "../hooks/useVoiceInput"

/**
 * Voice control for the composer, two modes (the last choice sticks):
 *  - "transcribe" — dictate speech to text, streamed live into the editor (Web Speech API).
 *  - "audio" — record a voice message and drop it into the attachment tray (MediaRecorder).
 * Renders nothing where neither engine is supported; offers only the supported modes.
 */

type VoiceMode = "transcribe" | "audio"

const voiceModeAtom = atomWithStorage<VoiceMode>("agenta:agent-chat:voice-mode", "transcribe")

const mmss = (ms: number): string => {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

const VoiceInputButton = ({
    inputRef,
    onAudio,
    disabled,
}: {
    inputRef: RefObject<RichChatInputHandle | null>
    onAudio: (file: File) => void
    disabled?: boolean
}) => {
    const [mode, setMode] = useAtom(voiceModeAtom)
    const transcribe = useVoiceInput()
    const recorder = useAudioRecorder(onAudio)
    const baseRef = useRef("")

    // Stream the running transcript into the editor while dictating.
    useEffect(() => {
        if (mode !== "transcribe" || !transcribe.recording) return
        const base = baseRef.current
        const live = transcribe.liveText
        inputRef.current?.setMarkdown(base && live ? `${base} ${live}` : base || live)
    }, [mode, transcribe.recording, transcribe.liveText, inputRef])

    const modes: {key: VoiceMode; label: string; supported: boolean}[] = [
        {key: "transcribe", label: "Voice to text", supported: transcribe.supported},
        {key: "audio", label: "Voice message", supported: recorder.supported},
    ]
    const available = modes.filter((m) => m.supported)
    if (!available.length) return null
    const effective: VoiceMode = available.some((m) => m.key === mode) ? mode : available[0].key

    const recording = effective === "transcribe" ? transcribe.recording : recorder.recording
    const error = effective === "transcribe" ? transcribe.error : recorder.error

    const toggle = () => {
        if (recording) {
            if (effective === "transcribe") {
                transcribe.stop()
                inputRef.current?.focus()
            } else {
                recorder.stop()
            }
            return
        }
        if (effective === "transcribe") {
            baseRef.current = (inputRef.current?.getMarkdown() ?? "").trimEnd()
            transcribe.start()
        } else {
            recorder.start()
        }
    }

    const menuItems: MenuProps["items"] = available.map((m) => ({key: m.key, label: m.label}))

    const title =
        error ??
        (recording
            ? effective === "audio"
                ? "Recording — tap to attach"
                : "Stop dictation"
            : effective === "transcribe"
              ? "Voice to text"
              : "Record a voice message")

    return (
        <div className="flex items-center">
            <Tooltip title={title}>
                <Button
                    type="text"
                    icon={<Microphone size={16} weight={recording ? "fill" : "regular"} />}
                    onClick={toggle}
                    disabled={disabled}
                    aria-label={recording ? "Stop voice input" : title}
                    className={recording ? "!text-colorError animate-pulse" : undefined}
                />
            </Tooltip>
            {recording && effective === "audio" ? (
                <span className="text-xs tabular-nums text-colorError">
                    {mmss(recorder.elapsedMs)}
                </span>
            ) : null}
            {available.length > 1 && !recording ? (
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
