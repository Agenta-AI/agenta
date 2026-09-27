// @vitest-environment jsdom
import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {act, cleanup, fireEvent, render} from "@testing-library/react"
import {useRef} from "react"
import {afterEach, describe, expect, it, vi} from "vitest"

import VoiceInputButton from "../../../src/components/VoiceInputButton"
import {useVoiceComposer} from "../../../src/hooks/useVoiceComposer"

let recognition: Recognition
class Recognition {
    continuous = false
    interimResults = false
    lang = ""
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: ((event: {error: string}) => void) | null = null
    onresult: ((event: unknown) => void) | null = null
    start() {
        recognition = this
        this.onstart?.()
    }
    stop() {}
    abort() {}
}

function Composer() {
    const inputRef = useRef<RichChatInputHandle>(null)
    const voice = useVoiceComposer({
        richInputRef: inputRef,
        stagedCount: 0,
        onAttach: vi.fn(),
        onSendVoiceMessage: vi.fn(),
    })
    return (
        <>
            <RichChatInput ref={inputRef} onSubmit={vi.fn()} dictating={voice.dictating} />
            <VoiceInputButton
                inputRef={inputRef}
                onStartAudio={voice.startVoiceMessage}
                audioSupported={false}
                audioPending={false}
                audioPerceivable={null}
                attachmentsFull={false}
                onDictatingChange={voice.setDictating}
                onDictationError={voice.setDictationError}
            />
            <div role="alert">{voice.micError}</div>
        </>
    )
}

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe("mobile tap dictation", () => {
    it("keeps the final words in the real editor after the second tap", async () => {
        vi.stubGlobal("SpeechRecognition", Recognition)
        vi.stubGlobal(
            "matchMedia",
            vi
                .fn()
                .mockReturnValue({
                    matches: true,
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                }),
        )
        const getUserMedia = vi.fn()
        vi.stubGlobal("navigator", {language: "en-US", mediaDevices: {getUserMedia}})
        const view = render(<Composer />)
        fireEvent.click(view.getByRole("button", {name: "Dictate into the message"}))
        expect(view.getByRole("button", {name: "Stop voice input"})).toBeTruthy()
        expect(getUserMedia).not.toHaveBeenCalled()
        fireEvent.click(view.getByRole("button", {name: "Stop voice input"}))
        await act(async () => {
            recognition.onresult?.({
                resultIndex: 0,
                results: [{isFinal: true, 0: {transcript: "A message from my phone"}}],
            })
            recognition.onend?.()
        })
        expect(view.getByRole("textbox", {name: "Chat message"}).textContent).toBe(
            "A message from my phone",
        )
        expect(view.getByRole("alert").textContent).toBe("")
    })
})
