/**
 * @vitest-environment jsdom
 *
 * A settled tool row follows a catalog that loads late. The language switch can finish on the
 * catalog timeout with the English text; when the catalog arrives after it, the row must update.
 */
import {activeLanguageAtom} from "@agenta/i18n"
import {languageAtom, useLanguageSync} from "@agenta/i18n/language"
import {cleanup, render, renderHook, waitFor} from "@testing-library/react"
import type {ToolUIPart} from "ai"
import {getDefaultStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ActivityToolStep} from "../../../src/components/activity/ActivityToolStep"

vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolIntegrationDetail: () => ({integration: null}),
}))

const store = getDefaultStore()

const part = {
    type: "tool-read_config",
    toolCallId: "c1",
    state: "output-available",
    input: {},
    output: "ok",
} as unknown as ToolUIPart

afterEach(() => {
    cleanup()
    store.set(languageAtom, "en")
    store.set(activeLanguageAtom, "en")
})

describe("ActivityToolStep language", () => {
    it("re-renders a settled row when its catalog loads after the language is active", async () => {
        // The language is active, but its catalog has not arrived: the row reads in English.
        store.set(activeLanguageAtom, "ja-JP")
        const {container} = render(<ActivityToolStep part={part} files={[]} />)
        expect(container.textContent).toContain("Read the agent's setup")

        // The catalog now loads. Only the catalog revision changes, not the language.
        store.set(languageAtom, "ja-JP")
        const sync = renderHook(() => useLanguageSync())
        await waitFor(() =>
            expect(container.textContent).toContain("エージェントの設定を読み込みました"),
        )
        sync.unmount()
    })
})
