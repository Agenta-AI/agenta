import {useEffect, useRef, type RefObject} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Microphone} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

import {useVoiceInput} from "../hooks/useVoiceInput"

/** Mic button for the composer: dictates speech into the editor as plain text (Web Speech API).
 * Hidden where the browser has no SpeechRecognition. */
const VoiceInputButton = ({
    inputRef,
    disabled,
}: {
    inputRef: RefObject<RichChatInputHandle | null>
    disabled?: boolean
}) => {
    const {supported, recording, liveText, error, start, stop} = useVoiceInput()
    const baseRef = useRef("")

    // Stream base text + the running transcript into the editor while dictating.
    useEffect(() => {
        if (!recording) return
        const base = baseRef.current
        inputRef.current?.setMarkdown(base && liveText ? `${base} ${liveText}` : base || liveText)
    }, [recording, liveText, inputRef])

    if (!supported) return null

    const toggle = () => {
        if (recording) {
            stop()
            inputRef.current?.focus()
            return
        }
        baseRef.current = (inputRef.current?.getMarkdown() ?? "").trimEnd()
        start()
    }

    return (
        <Tooltip title={error ?? (recording ? "Stop dictation" : "Voice input")}>
            <Button
                type="text"
                icon={<Microphone size={16} weight={recording ? "fill" : "regular"} />}
                onClick={toggle}
                disabled={disabled}
                aria-label={recording ? "Stop voice input" : "Start voice input"}
                className={recording ? "!text-colorError animate-pulse" : undefined}
            />
        </Tooltip>
    )
}

export default VoiceInputButton
