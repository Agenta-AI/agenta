import {act, createRef, useRef} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {BrowserLiveSurface} from "../../src/browser/BrowserLiveSurface"
import type {BrowserLiveClientMessage} from "../../src/browser/live"
import {
    useBrowserLiveSocket,
    type BrowserLiveConnection,
    type BrowserLiveStatus,
} from "../../src/browser/useBrowserLiveSocket"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

class FakeSocket {
    static OPEN = 1
    static last: FakeSocket | null = null
    readyState = 0
    sent: string[] = []
    onopen: (() => void) | null = null
    onmessage: ((event: {data: string}) => void) | null = null
    onerror: (() => void) | null = null
    onclose: ((event: {code: number}) => void) | null = null
    constructor(public url: string) {
        FakeSocket.last = this
    }
    send(data: string) {
        this.sent.push(data)
    }
    close() {}
    open() {
        this.readyState = FakeSocket.OPEN
        this.onopen?.()
    }
    receive(message: object) {
        this.onmessage?.({data: JSON.stringify(message)})
    }
}

const realWebSocket = globalThis.WebSocket
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    globalThis.WebSocket = realWebSocket
})

describe("useBrowserLiveSocket", () => {
    const phases: string[] = []
    const Probe = () => {
        const canvasRef = useRef<HTMLCanvasElement | null>(null)
        const {connection, viewport} = useBrowserLiveSocket("ws://test/browser/live", canvasRef)
        phases.push(connection.phase)
        return <output>{`${viewport.width}x${viewport.height}`}</output>
    }

    beforeEach(() => {
        phases.length = 0
    })

    it("stays connecting through an open socket that the server then refuses", () => {
        act(() => root.render(<Probe />))
        const socket = FakeSocket.last!
        act(() => socket.open())
        act(() => socket.onclose?.({code: 4403}))
        expect(phases).not.toContain("live")
        expect(phases.at(-1)).toBe("error")
    })

    it("goes live on the first status message", () => {
        act(() => root.render(<Probe />))
        const socket = FakeSocket.last!
        act(() => socket.open())
        expect(phases.at(-1)).toBe("connecting")
        act(() =>
            socket.receive({type: "status", control: "agent", url: "", title: "", waiting: ""}),
        )
        expect(phases.at(-1)).toBe("live")
    })

    it("reports the viewport of the latest frame", () => {
        act(() => root.render(<Probe />))
        expect(container.textContent).toBe("1280x800")
        act(() => FakeSocket.last!.receive({type: "frame", data: "", width: 390, height: 844}))
        expect(container.textContent).toBe("390x844")
    })
})

describe("BrowserLiveSurface control buttons", () => {
    const live: BrowserLiveConnection = {phase: "live"}
    const status = (over: Partial<BrowserLiveStatus>): BrowserLiveStatus => ({
        control: "agent",
        url: "https://example.com/",
        title: "Example",
        waiting: "",
        ...over,
    })
    const renderSurface = (current: BrowserLiveStatus) => {
        const sent: BrowserLiveClientMessage[] = []
        act(() =>
            root.render(
                <BrowserLiveSurface
                    connection={live}
                    status={current}
                    viewport={{width: 1280, height: 800}}
                    canvasRef={createRef()}
                    send={(message) => sent.push(message)}
                    onReconnect={() => {}}
                />,
            ),
        )
        return sent
    }
    const click = (label: string) => {
        const button = [...container.querySelectorAll("button")].find(
            (node) => node.textContent === label,
        )
        if (!button) throw new Error(`no "${label}" button`)
        act(() => button.click())
    }

    it("ends the wait with done, not by giving back control", () => {
        const sent = renderSurface(status({control: "user", waiting: "Log in"}))
        click("I'm done")
        click("Give back control")
        expect(sent).toEqual([{type: "done"}, {type: "control", take: false}])
    })

    it("offers I'm done while the agent waits, even before the person takes control", () => {
        const sent = renderSurface(status({waiting: "Log in"}))
        click("Take control")
        click("I'm done")
        expect(sent).toEqual([{type: "control", take: true}, {type: "done"}])
    })

    it("hides I'm done when nothing waits", () => {
        renderSurface(status({control: "user"}))
        expect(container.textContent).not.toContain("I'm done")
    })
})
