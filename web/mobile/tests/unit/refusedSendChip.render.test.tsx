// @vitest-environment jsdom
//
// The refusal's own sentence has to reach the composer on `/m`, which is the production default.
//
// QA-D6: a refused send said only "Message wasn't sent", because the send path cancelled the 422
// body and threw the status number. The package now reads that body and the chip states the
// reason, and both are pinned in `@agenta/chat`. What was NOT pinned is this app's own call site
// — the one line in the composer's catch that puts `describeRefusedSend(error)` on the rejection —
// so replacing it with a hardcoded string left every suite green.
import {act} from "react"

import {useComposerAttachments} from "@agenta/chat/hooks"
import {SendRefusedError} from "@agenta/chat/model"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it} from "vitest"

import {Composer} from "@/features/chat/Composer"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
})

const settle = async () => {
    for (let i = 0; i < 6; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/**
 * The composer takes its attachments state from the caller, so the harness holds the real hook
 * the way the conversation screen does. The rejection this case reads is written to that state.
 */
const ComposerHarness = ({onSend}: {onSend: () => Promise<never>}) => {
    const attachments = useComposerAttachments({sessionId: "session-1"})
    return (
        <Composer
            entityId="revision-1"
            sessionId="session-1"
            attachments={attachments}
            onSend={onSend}
        />
    )
}

/** Mount the composer with a send that refuses the way the invoke lane does. */
const mountWithRefusal = async (error: unknown) => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root!.render(
            <Provider store={createStore()}>
                <ComposerHarness onSend={() => Promise.reject(error)} />
            </Provider>,
        )
    })
    await settle()
}

const editor = () => document.querySelector<HTMLElement>('[aria-label="Chat message"]')

/** Type and press Enter, the way a person sends. */
const send = async (text: string) => {
    const input = editor()
    if (!input) throw new Error("the composer's editor never mounted")
    await act(async () => {
        input.focus()
        input.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, data: text}))
        input.textContent = text
        input.dispatchEvent(new InputEvent("input", {bubbles: true, data: text}))
    })
    await settle()
    await act(async () => {
        input.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Enter", keyCode: 13, which: 13, bubbles: true}),
        )
    })
    await settle()
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ").trim()

describe("mobile composer: a send the server refused", () => {
    it("states the refusal's own reason, not just that the message did not go", async () => {
        await mountWithRefusal(
            new SendRefusedError({
                status: 422,
                statedReason: "No model provider is configured.",
                refusalCode: "secret_missing",
            }),
        )
        await send("hello")

        expect(text()).toContain("wasn't sent — No model provider is configured.")
    })

    it("keeps the standing wording when the refusal stated nothing", async () => {
        // A rejection with no refusal behind it at all reads the same as it always did, which is
        // what stops this becoming a worse message than the one it replaced.
        await mountWithRefusal(new Error("boom"))
        await send("hello")

        expect(text()).toContain("wasn't sent — try again.")
    })
})
