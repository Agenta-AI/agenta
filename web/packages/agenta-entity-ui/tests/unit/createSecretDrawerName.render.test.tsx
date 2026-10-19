/**
 * The name a new secret is offered, which says what the secret is to the server: a key the
 * relay sends, or the secret of an OAuth app the person registered.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("@agenta/ui/shared-editor", () => ({
    SharedEditor: () => createElement("div", {"data-testid": "shared-editor"}),
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => [],
    useSetAtom: () => async () => undefined,
}))

import {CreateSecretDrawer} from "../../src/secret/CreateSecretDrawer"

class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const offeredName = async (nameSuffix?: string) => {
    await act(async () => {
        root.render(
            createElement(CreateSecretDrawer, {
                open: true,
                onClose: () => undefined,
                serverName: "Acme",
                nameSuffix,
                onCreated: () => undefined,
            }),
        )
    })
    const inputs = [...document.querySelectorAll("input")] as HTMLInputElement[]
    return inputs.map((input) => input.value).find((value) => value.startsWith("ACME"))
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

describe("the name a new secret is offered", () => {
    it("names a key as the server's API key", async () => {
        expect(await offeredName()).toBe("ACME_API_KEY")
    })

    it("names an OAuth app's secret as that, not as an API key", async () => {
        expect(await offeredName("OAUTH_CLIENT_SECRET")).toBe("ACME_OAUTH_CLIENT_SECRET")
    })
})
