// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {router} = vi.hoisted(() => ({
    router: {
        pathname: "/w/[workspace_id]/p/[project_id]/observability",
        query: {} as Record<string, string>,
        push: vi.fn(),
        replace: vi.fn(),
    },
}))
vi.mock("next/router", () => ({useRouter: () => router}))

import {useSessionDrawerUrl} from "@/features/observability/sessionDrawer/useSessionDrawerUrl"

const Probe = () => {
    const {spanId, close} = useSessionDrawerUrl()
    return <button onClick={close}>{`close ${String(spanId)}`}</button>
}

describe("useSessionDrawerUrl", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        router.push.mockReset()
        router.replace.mockReset()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Reads the span a link carried", () => {
        router.query = {workspace_id: "ws", project_id: "pr", session: "s", span: "span-1"}
        act(() => root.render(<Probe />))
        expect(host.textContent).toBe("close span-1")
    })

    it("Close removes session and span from the URL with replace and keeps the rest", () => {
        router.query = {workspace_id: "ws", project_id: "pr", session: "s", span: "span-1"}
        window.history.replaceState(
            null,
            "",
            "/observability?app=app-1&trace=t1&session=s&span=span-1",
        )
        act(() => root.render(<Probe />))
        act(() => host.querySelector("button")?.click())

        expect(router.push).not.toHaveBeenCalled()
        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: router.pathname,
                query: {workspace_id: "ws", project_id: "pr", app: "app-1", trace: "t1"},
            },
            undefined,
            {shallow: true},
        )
    })
})
