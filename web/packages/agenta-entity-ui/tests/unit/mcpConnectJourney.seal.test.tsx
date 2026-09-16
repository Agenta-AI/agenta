/**
 * D29: the window in which the connection is real and the dialog has not caught up.
 *
 * The credential exchange happens server-side, in the callback. From the moment consent returns
 * the grant exists at the provider whatever this dialog does next, so a cancel in that window
 * used to delete a row whose grant the API had already stored — orphaning it.
 *
 * The reducer half is pinned by the journey's own suite: `saving` counts as connected, so
 * nothing deletes from there. This is the other half, and it was unguarded. Escape and a mask
 * click reach the close handler even while the footer's buttons are disabled, so the dialog is
 * sealed across that window as well, and the handler itself refuses to run.
 *
 * The journey hook is stubbed here on purpose: what is under test is the dialog's own decision
 * given a state, not how the state is reached. The dialog renders through a portal, so every
 * query goes to the document.
 */
import {act, createElement} from "react"

import type {McpJourneyState, McpJourneyStatus} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {useMcpConnectJourney} = vi.hoisted(() => ({useMcpConnectJourney: vi.fn()}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    useMcpConnectJourney,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => [],
    useSetAtom: () => async () => undefined,
}))

import McpConnectJourney from "../../src/mcpEndpoint/McpConnectJourney"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let cancel: ReturnType<typeof vi.fn>
let onClose: ReturnType<typeof vi.fn>

const stateAt = (status: McpJourneyStatus): McpJourneyState => ({
    status,
    url: "https://mcp.acme.test",
    name: "Acme",
    nameTouched: false,
    probe: null,
    scopesOffered: [],
    scopesSelected: [],
    endpointId: "mcp-1",
    slug: "acme",
    createdHere: true,
    tools: [],
    error: null,
})

const settle = async () => {
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/** Open the real dialog with the journey held at one status. */
const openAt = async (status: McpJourneyStatus) => {
    useMcpConnectJourney.mockReturnValue({
        state: stateAt(status),
        popupName: "mcp_consent",
        expectsConsent: false,
        setUrl: vi.fn(),
        submitUrl: vi.fn(),
        loadTools: vi.fn(),
        setName: vi.fn(),
        submitName: vi.fn(),
        toggleScope: vi.fn(),
        submitScopes: vi.fn(),
        startScopeDiscovery: vi.fn(),
        submitManualCredential: vi.fn(),
        skipAuthentication: vi.fn(),
        // Never resolves: `saving` is exactly the window in which the local bookkeeping is
        // still in flight, and a `finish` that answered at once would end it before a person
        // could press anything.
        finish: vi.fn(() => new Promise(() => undefined)),
        cancel,
        retry: vi.fn(),
        retryTools: vi.fn(),
        stopWatch: vi.fn(),
        abandonAttempt: vi.fn(),
    })
    await act(async () => {
        root.render(createElement(McpConnectJourney, {open: true, onClose}))
    })
    await settle()
}

const dialog = () => document.querySelector('[data-testid="mcp-connect-journey"]')

/**
 * A pointer press outside the panel, which is what a mask click is.
 *
 * jsdom has no PointerEvent constructor; the dismissable layer listens for the event NAME, and
 * binds its listener from a `setTimeout(0)`, so the flush below has to reach a macrotask.
 */
const clickOutside = async () => {
    await act(async () => {
        // The WHOLE gesture. The layer defers its dismissal to a following `click` when the
        // press carries no `pointerType`, which a synthesized MouseEvent never does, so a bare
        // pointerdown leaves it waiting and the case would pass on an event nobody acted on.
        document.body.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true}),
        )
        document.body.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}))
    })
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
}

const pressEscape = async () => {
    await act(async () => {
        document.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}),
        )
    })
    await settle()
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    cancel = vi.fn()
    onClose = vi.fn()
    useMcpConnectJourney.mockReset()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
})

describe("McpConnectJourney: the dialog is sealed while the connection is being saved", () => {
    it("offers no way out at all", async () => {
        await openAt("saving")

        expect(dialog()).toBeTruthy()
        // The X is the third route out, and the one a disabled footer does not cover.
        expect(document.querySelector('[aria-label="Close"]')).toBeNull()
    })

    it("ignores Escape", async () => {
        await openAt("saving")
        await pressEscape()

        expect(onClose).not.toHaveBeenCalled()
        expect(cancel).not.toHaveBeenCalled()
        expect(dialog()).toBeTruthy()
    })

    it("ignores a click on the mask", async () => {
        await openAt("saving")
        await clickOutside()

        expect(onClose).not.toHaveBeenCalled()
        expect(cancel).not.toHaveBeenCalled()
        expect(dialog()).toBeTruthy()
    })
})

describe("McpConnectJourney: a busy state with nothing yet to protect", () => {
    it("still closes and cancels on Escape while the row is being created", async () => {
        // The other half of the seal: `creating` is busy and its footer is disabled too, so a
        // seal keyed on "busy" rather than on "connected" would trap a person here with a row
        // that should be cleaned up.
        await openAt("creating")
        await pressEscape()

        expect(onClose).toHaveBeenCalled()
        expect(cancel).toHaveBeenCalled()
    })

    it("still closes and cancels on a mask click while the row is being created", async () => {
        // The discriminator for the sealed mask case above. Without it that case is satisfied by
        // an environment that never delivers the event at all, which is the shape of a guard that
        // proves nothing. Both halves of the seal — the `maskClosable` prop and the close
        // handler's own early return — independently stop the sealed click, so removing either
        // one alone leaves the sealed case green; this is what makes the PAIR observable.
        await openAt("creating")
        await clickOutside()

        expect(onClose).toHaveBeenCalled()
        expect(cancel).toHaveBeenCalled()
    })

    it("offers the X while the row is being created", async () => {
        await openAt("creating")

        expect(document.querySelector('[aria-label="Close"]')).toBeTruthy()
    })
})
