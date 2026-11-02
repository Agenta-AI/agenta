// @vitest-environment jsdom
import {act, cleanup, renderHook} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {useVoiceComposer} from "../../../src/hooks/useVoiceComposer"

// Speech recognition owns the microphone. The composer must not open another capture on mobile.
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe("mobile dictation microphone ownership", () => {
    it.each([true, false])(
        "opens the waveform microphone only on desktop (touch: %s)",
        async (touch) => {
            vi.stubGlobal(
                "matchMedia",
                vi.fn().mockReturnValue({
                    matches: touch,
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                }),
            )
            const stop = vi.fn()
            const getUserMedia = vi.fn().mockResolvedValue({getTracks: () => [{stop}]})
            vi.stubGlobal("navigator", {mediaDevices: {getUserMedia}})
            const {result, unmount} = renderHook(() =>
                useVoiceComposer({
                    richInputRef: {current: null},
                    stagedCount: 0,
                    onAttach: vi.fn(),
                    onSendVoiceMessage: vi.fn(),
                }),
            )
            await act(async () => result.current.setDictating(true))
            expect(getUserMedia).toHaveBeenCalledTimes(touch ? 0 : 1)
            if (touch) expect(result.current.dictationAnalyserRef).toBeUndefined()
            else expect(result.current.dictationAnalyserRef).toBeDefined()
            unmount()
            if (!touch) expect(stop).toHaveBeenCalled()
        },
    )
})
