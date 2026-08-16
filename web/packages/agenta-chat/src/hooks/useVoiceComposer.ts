import {type RefObject, useState} from "react"

import {agentVoiceInputEnabledAtom} from "@agenta/shared/state"
import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useAtomValue} from "jotai"

import {isAgentVoiceInputAvailable} from "../assets/voice"

import {useAudioRecorder} from "./useAudioRecorder"

/**
 * The composer's voice surface for one session: the recorder that backs the recording takeover,
 * the send-vs-attach decision for a finished take, and the shared mic/dictation error the notice
 * above the composer renders. Dictation itself lives inside the mic button (its transcript changes
 * far too often to lift here) and only reports up through here.
 */
export const useVoiceComposer = ({
    richInputRef,
    stagedCount,
    onAttach,
    onSendVoiceMessage,
}: {
    richInputRef: RefObject<RichChatInputHandle | null>
    /** How many attachments are already staged — part of the send-vs-attach decision. */
    stagedCount: number
    /** Park the take in the attachment tray. */
    onAttach: (file: File) => void
    /** Send the take outright as its own message. */
    onSendVoiceMessage: (file: File) => void
}) => {
    // Voice-message recording: the clip lands in the attachment tray like any file. Owned here so
    // the recording takeover (RecordingBar) can cover the whole composer while capturing.
    /**
     * A voice message recorded into an otherwise-empty composer IS the message, so the take is
     * sent on confirm rather than parked in the tray. With text or other attachments staged, the
     * person is mid-composition, so it attaches instead and they send when ready.
     *
     * Decided when recording STARTS: the composer is covered by the recording bar and drops are
     * blocked while capturing, so neither the text nor the tray can change in between.
     */
    // Experimental: off until the person turns it on in Settings, or the deployment forces it on
    // with `NEXT_PUBLIC_AGENT_VOICE_INPUT`.
    const voiceSettingEnabled = useAtomValue(agentVoiceInputEnabledAtom)
    const voiceEnabled = isAgentVoiceInputAvailable(voiceSettingEnabled)
    const [voiceWillSend, setVoiceWillSend] = useState(false)
    const voiceRecorder = useAudioRecorder((file) => {
        if (voiceWillSend) onSendVoiceMessage(file)
        else onAttach(file)
    })
    const startVoiceMessage = () => {
        const hasText = !!(richInputRef.current?.getMarkdown() ?? "").trim()
        setVoiceWillSend(!hasText && stagedCount === 0)
        voiceRecorder.start()
    }
    // Dictation runs inside the mic button (its transcript changes far too often to lift here), so
    // it reports failures up for the shared notice.
    const [dictationError, setDictationError] = useState<string | null>(null)
    // Locks the editor while speech is coming in, so typing can't interleave with the transcript.
    const [dictating, setDictating] = useState(false)
    const micError = voiceRecorder.error ?? dictationError
    const dismissMicError = () => {
        setDictationError(null)
        voiceRecorder.dismissError()
    }

    return {
        voiceEnabled,
        voiceRecorder,
        voiceWillSend,
        startVoiceMessage,
        dictating,
        setDictating,
        setDictationError,
        micError,
        dismissMicError,
    }
}
