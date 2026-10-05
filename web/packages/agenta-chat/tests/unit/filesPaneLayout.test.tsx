import {act, useEffect, useRef, useState} from "react"
import {createRoot} from "react-dom/client"

import {Provider, createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {useFilesPaneLayout} from "../../src/state/filesPaneLayout"
import {
    chatPanelMaximizedAtom,
    configPanelCollapsedAtom,
    configPanelCollapsedPreferenceAtom,
    configPanelCollapsedPhonePreferenceAtom,
    filesPaneWidthAtom,
    phoneViewportAtom,
    rightPanelWidthAtom,
} from "../../src/state/panelLayout"

function Runtime() {
    const instance = useRef({})
    const [counter, setCounter] = useState(0)
    useEffect(() => {
        const timer = setInterval(() => setCounter((n) => n + 1), 10)
        return () => clearInterval(timer)
    }, [])
    return (
        <div data-instance={String(instance.current)}>
            <iframe title="Running app" srcDoc="<button>Counter</button>" />
            <textarea defaultValue="unsaved" />
            <span data-stream>{counter}</span>
        </div>
    )
}

for (const host of ["m:agent-first", "w:drawer:chat-scope"]) {
    describe(`${host} transient file layout`, () => {
        it("retains intent, instances, drafts and both viewport preferences without a storage write", async () => {
            const store = createStore()
            store.set(configPanelCollapsedPreferenceAtom, false)
            store.set(configPanelCollapsedPhonePreferenceAtom, true)
            store.set(rightPanelWidthAtom, 460)
            store.set(filesPaneWidthAtom, 620)
            let props = {open: true, session: "session-1"}
            const mount = document.createElement("div")
            document.body.appendChild(mount)
            const root = createRoot(mount)
            function Host() {
                const layout = useFilesPaneLayout(host, props.session, props.open)
                return (
                    <>
                        <button
                            onClick={() => layout.toggleExpand(false)}
                            aria-pressed={layout.expanded}
                        >
                            Toggle
                        </button>
                        <div
                            data-retaining={layout.retaining}
                            data-collapsed={layout.configCollapsed}
                        >
                            <Runtime />
                        </div>
                    </>
                )
            }
            const render = () =>
                act(() =>
                    root.render(
                        <Provider store={store}>
                            <Host />
                        </Provider>,
                    ),
                )
            render()
            const iframe = mount.querySelector("iframe")
            const editor = mount.querySelector("textarea")!
            editor.value = "my dirty draft"
            const click = () => act(() => mount.querySelector("button")!.click())
            click()
            expect(mount.querySelector("button")!.getAttribute("aria-pressed")).toBe("true")
            act(() => store.set(phoneViewportAtom, true))
            expect(mount.querySelector("button")!.getAttribute("aria-pressed")).toBe("true")
            await act(async () => {
                await new Promise((r) => setTimeout(r, 40))
            })
            expect(Number(mount.querySelector("[data-stream]")!.textContent)).toBeGreaterThan(0)
            click()
            expect(mount.querySelector("button")!.getAttribute("aria-pressed")).toBe("false")
            expect(mount.querySelector("[data-retaining]")!.getAttribute("data-retaining")).toBe(
                "true",
            )
            expect(mount.querySelector("iframe")).toBe(iframe)
            expect(mount.querySelector("textarea")).toBe(editor)
            expect(editor.value).toBe("my dirty draft")
            expect(store.get(configPanelCollapsedPreferenceAtom)).toBe(false)
            expect(store.get(configPanelCollapsedPhonePreferenceAtom)).toBe(true)
            expect(store.get(rightPanelWidthAtom)).toBe(460)
            expect(store.get(filesPaneWidthAtom)).toBe(620)
            click()
            props = {...props, open: false}
            render()
            props = {...props, open: true}
            render()
            expect(mount.querySelector("button")!.getAttribute("aria-pressed")).toBe("false")
            click()
            props = {...props, session: "session-2"}
            render()
            expect(mount.querySelector("button")!.getAttribute("aria-pressed")).toBe("false")
            click()
            act(() => store.set(configPanelCollapsedAtom, false))
            expect(mount.querySelector("button")!.getAttribute("aria-pressed")).toBe("false")
            click()
            act(() => store.set(chatPanelMaximizedAtom, true))
            expect(mount.querySelector("button")!.getAttribute("aria-pressed")).toBe("false")
            act(() => root.unmount())
            mount.remove()
        })
    })
}
