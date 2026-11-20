// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {
    KEPT_CONVERSATIONS,
    KeptConversations,
    useKeptConversations,
} from "@/features/chat/keptConversations"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/** A conversation that counts its own mounts, so a remount shows. */
const mounts = new Map<string, number>()
const Conversation = ({sessionId}: {sessionId: string}) => {
    if (!mounts.has(sessionId)) mounts.set(sessionId, 0)
    return (
        <div
            data-testid="conversation"
            data-session={sessionId}
            ref={(el) => {
                if (el && !el.dataset.counted) {
                    el.dataset.counted = "1"
                    mounts.set(sessionId, (mounts.get(sessionId) ?? 0) + 1)
                }
            }}
        />
    )
}

const Screen = ({sessionId, live = true}: {sessionId: string; live?: boolean}) => {
    const element = live ? <Conversation key={sessionId} sessionId={sessionId} /> : null
    const kept = useKeptConversations(sessionId, element)
    return live ? <KeptConversations sessionId={sessionId} kept={kept} /> : null
}

describe("kept conversations", () => {
    let host: HTMLDivElement
    let root: Root
    const show = (sessionId: string, live?: boolean) =>
        act(async () => root.render(<Screen sessionId={sessionId} live={live} />))
    const rendered = () =>
        [...host.querySelectorAll<HTMLElement>('[data-testid="conversation"]')].map((el) => ({
            id: el.dataset.session,
            visible: el.style.display !== "none",
        }))

    beforeEach(() => {
        mounts.clear()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
    })

    it("keeps the last conversations mounted and shows only the open one, first", async () => {
        await show("a")
        await show("b")
        expect(rendered()).toEqual([
            {id: "b", visible: true},
            {id: "a", visible: false},
        ])
        await show("a")
        expect(rendered()[0]).toEqual({id: "a", visible: true})
        // A return is not a remount.
        expect(mounts.get("a")).toBe(1)
    })

    it(`keeps at most ${KEPT_CONVERSATIONS}, dropping the one left longest ago`, async () => {
        for (const id of ["a", "b", "c", "d"]) await show(id)
        expect(
            rendered()
                .map((entry) => entry.id)
                .sort(),
        ).toEqual(["b", "c", "d"])
        await show("a")
        expect(mounts.get("a")).toBe(2)
    })
})
