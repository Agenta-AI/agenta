import {useEffect, useRef, type RefObject} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {CaretDown, Microphone} from "@phosphor-icons/react"
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

const voiceModeAtom = atomWithStorage<VoiceMode>("agenta:agent-chat:voice-mode", "transcribe")

const VoiceInputButton = ({
    inputRef,
    onStartAudio,
    audioSupported,
    disabled,
}: {
    inputRef: RefObject<RichChatInputHandle | null>
    onStartAudio: () => void
    audioSupported: boolean
    disabled?: boolean
}) => {
    const [mode, setMode] = useAtom(voiceModeAtom)
    const transcribe = useVoiceInput()
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
        {key: "audio", label: "Voice message", supported: audioSupported},
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
            inputRef.current?.focus()
        } else {
            baseRef.current = (inputRef.current?.getMarkdown() ?? "").trimEnd()
            transcribe.start()
        }
    }

    const menuItems: MenuProps["items"] = available.map((m) => ({key: m.key, label: m.label}))

    const title =
        (effective === "transcribe" ? transcribe.error : null) ??
        (dictating
            ? "Stop dictation"
            : effective === "transcribe"
              ? "Voice to text"
              : "Record a voice message")

    return (
        <div className="flex items-center">
            <Tooltip title={title}>
                <Button
                    type="text"
                    icon={<Microphone size={16} weight={dictating ? "fill" : "regular"} />}
                    onClick={toggle}
                    disabled={disabled}
                    aria-label={dictating ? "Stop voice input" : title}
                    className={dictating ? "!text-colorError animate-pulse" : undefined}
                />
            </Tooltip>
            {available.length > 1 && !dictating ? (
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
