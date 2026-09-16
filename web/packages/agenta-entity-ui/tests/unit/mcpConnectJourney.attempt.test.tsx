/**
 * D34 and D40: who owns an attempt, and what the popup contract is.
 *
 * Every step of the consent path has a window between an await and the thing it installs. A
 * cancel or an unmount inside that window used to leave the work to arrive afterwards and
 * install itself anyway: a watch holding a listener, an interval and a three-minute timeout
 * on a dead attempt, or an endpoint row that the cancel had no way to find. OR67's teardown
 * cannot cover it, because at that moment there is nothing installed to tear down.
 *
 * The popup cases are the rest of D40. They are about the contract the watch depends on:
 * one window per attempt, opened by the caller, and the API's origin as the only one trusted
 * to say a consent finished.
 */
import {act, createElement} from "react"

import {PROBE_TIMEOUT_MS, useMcpConnectJourney} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {
    probeMcpUrl,
    createMcpEndpoint,
    deleteMcpEndpoint,
    beginMcpConnect,
    discoverMcpConnect,
    listMcpTools,
    queryMcpEndpoints,
} = vi.hoisted(() => ({
    probeMcpUrl: vi.fn(),
    createMcpEndpoint: vi.fn(),
    deleteMcpEndpoint: vi.fn(),
    beginMcpConnect: vi.fn(),
    discoverMcpConnect: vi.fn(),
    listMcpTools: vi.fn(),
    queryMcpEndpoints: vi.fn(),
}))

vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    probeMcpUrl,
    createMcpEndpoint,
    deleteMcpEndpoint,
    beginMcpConnect,
    discoverMcpConnect,
    listMcpTools,
    queryMcpEndpoints,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test/api"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
    useSetAtom: () => async () => undefined,
}))

type Journey = ReturnType<typeof useMcpConnectJourney>

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let journey: Journey

const mountJourney = async () => {
    const Probe = () => {
        journey = useMcpConnectJourney({})
        return null
    }
    await act(async () => {
        root.render(createElement(Probe))
    })
}

const settle = async () => {
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/** A promise this test settles by hand, so an await can be held open. */
const deferred = <T,>() => {
    let release!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((resolve, fail) => {
        release = resolve
        reject = fail
    })
    return {promise, release, reject}
}

/** The journey as a reconnect opens it: the connection is known before anything is asked. */
const mountReconnectJourney = async () => {
    const Probe = () => {
        journey = useMcpConnectJourney({
            reconnect: {
                id: "mcp-1",
                slug: "acme-7mx",
                name: "Acme",
                url: "https://mcp.acme.test/",
                authMode: "oauth",
            },
        })
        return null
    }
    await act(async () => {
        root.render(createElement(Probe))
    })
}

const fakePopup = () => ({closed: false, close: vi.fn(), location: {href: ""}}) as never

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    probeMcpUrl.mockResolvedValue({
        count: 1,
        probe: {reachable: true, server_name: "Acme", auth: {mode: "oauth", scopes_offered: []}},
    })
    createMcpEndpoint.mockResolvedValue({
        count: 1,
        endpoint: {id: "mcp-1", slug: "acme-7mx", name: "Acme", auth_mode: "oauth"},
    })
    deleteMcpEndpoint.mockResolvedValue(undefined)
    beginMcpConnect.mockResolvedValue({count: 1, redirect_url: "https://issuer.test/authorize"})
    discoverMcpConnect.mockResolvedValue({count: 1, scopes_offered: ["tools:list"]})
    queryMcpEndpoints.mockResolvedValue({count: 0, endpoints: []})
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("cancelling while the connection is being created", () => {
    it("deletes the row that arrives afterwards", async () => {
        const create = deferred<unknown>()
        createMcpEndpoint.mockReturnValue(create.promise)

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        // Started, and still in flight.
        void journey.submitName()
        await settle()

        // The cancel has no row to delete: it does not exist yet.
        await act(async () => {
            await journey.cancel()
        })
        expect(deleteMcpEndpoint).not.toHaveBeenCalled()

        create.release({
            count: 1,
            endpoint: {id: "mcp-late", slug: "late", name: "Acme", auth_mode: "oauth"},
        })
        await settle()

        // Without the generation check this row stayed behind for good.
        expect(deleteMcpEndpoint).toHaveBeenCalledWith("mcp-late", "project-1")
    })
})

describe("cancelling while the authorization URL is being minted", () => {
    it("installs no watch, and closes the window it opened", async () => {
        const begin = deferred<unknown>()
        beginMcpConnect.mockReturnValue(begin.promise)
        const listeners = vi.spyOn(window, "addEventListener")
        const popup = fakePopup()

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()

        void journey.submitScopes(popup)
        await settle()
        await act(async () => {
            await journey.cancel()
        })

        begin.release({count: 1, redirect_url: "https://issuer.test/authorize"})
        await settle()

        // A watch installed here would hold a listener, an interval and a three-minute
        // timeout on an attempt nobody is waiting for.
        const messageListeners = listeners.mock.calls.filter(([type]) => type === "message")
        expect(messageListeners).toHaveLength(0)
        expect((popup as unknown as {close: ReturnType<typeof vi.fn>}).close).toHaveBeenCalled()
    })
})

describe("a name the server refuses", () => {
    it("shows the server's own sentence, next step and all", async () => {
        // The client refuses a collision it can already see, and the two sentences open the
        // same way. What tells them apart is the next step, which only the server writes, and
        // it has to survive the trip from the envelope to the field (D51).
        createMcpEndpoint.mockRejectedValue({
            response: {
                data: {
                    detail: {
                        code: "mcp_connection_name_taken",
                        message:
                            "Another connection in this project already uses this name; pick a different one.",
                        next_step: "Give this connection a name no other one in the project uses.",
                    },
                },
            },
        })

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()

        expect(journey.state.status).toBe("naming")
        expect(journey.state.error).toBe(
            "Another connection in this project already uses this name; pick a different one. " +
                "Give this connection a name no other one in the project uses.",
        )
    })
})

describe("a retry after a save whose response was lost", () => {
    const nameTaken = {
        response: {
            data: {
                detail: {
                    code: "mcp_connection_name_taken",
                    message:
                        "Another connection in this project already uses this name; pick a different one.",
                },
            },
        },
    }

    /** Type the URL and the name, then submit it. */
    const submitNamed = async (name = "Acme", url = "https://mcp.acme.test/") => {
        await act(async () => journey.setUrl(url))
        await act(async () => {
            await journey.submitUrl(url)
        })
        await act(async () => journey.setName(name))
        await act(async () => {
            await journey.submitName()
        })
        await settle()
    }

    it("continues from the row its own lost save already made", async () => {
        // The first save landed and only its answer was lost, so the retry's create is refused
        // by the row the person already owns. Telling them to rename it is a dead end: the only
        // way forward was to invent a second name for one connection (round 4, D3).
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-1",
                    slug: "acme-7mx",
                    name: "Acme",
                    auth_mode: "oauth",
                    data: {route: {base_url: "https://mcp.acme.test"}},
                },
            ],
        })

        await mountJourney()
        await submitNamed()

        expect(journey.state.status).toBe("discovering_scopes")
        expect(journey.state.endpointId).toBe("mcp-1")
        expect(journey.state.slug).toBe("acme-7mx")
        expect(journey.state.error).toBeNull()
    })

    it("does not claim the row it adopted, so cancelling leaves it alone", async () => {
        // The row it found is indistinguishable from one somebody else made a moment earlier.
        // Deleting that on cancel would destroy a connection this journey never created.
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-1",
                    slug: "acme-7mx",
                    name: "Acme",
                    data: {route: {base_url: "https://mcp.acme.test/"}},
                },
            ],
        })

        await mountJourney()
        await submitNamed()
        await act(async () => {
            await journey.cancel()
        })
        await settle()

        expect(journey.state.createdHere).toBe(false)
        expect(deleteMcpEndpoint).not.toHaveBeenCalled()
    })

    it("still refuses a name another server has already taken", async () => {
        // The name matches and the address does not, so this is the collision the refusal is
        // for: two connections to two servers cannot share one label.
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-9",
                    slug: "acme-other",
                    name: "Acme",
                    data: {route: {base_url: "https://mcp.somewhere-else.test"}},
                },
            ],
        })

        await mountJourney()
        await submitNamed()

        expect(journey.state.status).toBe("naming")
        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.error).toContain("already uses this name")
    })

    it("leaves the refusal standing when the connection list cannot be read", async () => {
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockRejectedValue(new Error("network down"))

        await mountJourney()
        await submitNamed()

        expect(journey.state.status).toBe("naming")
        expect(journey.state.error).toContain("already uses this name")
    })

    it("asks nothing extra when the save simply succeeds", async () => {
        await mountJourney()
        await submitNamed()

        expect(queryMcpEndpoints).not.toHaveBeenCalled()
        expect(journey.state.endpointId).toBe("mcp-1")
    })
})

describe("a step that comes back to an abandoned attempt", () => {
    // Two of the seven awaits checked the generation and the other five did not, so a probe or
    // a tool list that answered late still dispatched, on top of whatever the journey had moved
    // on to (D52).
    it("says nothing about a probe nobody is waiting for any more", async () => {
        const probe = deferred<unknown>()
        probeMcpUrl.mockReturnValue(probe.promise)

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        let submitted: Promise<void>
        await act(async () => {
            submitted = journey.submitUrl("https://mcp.acme.test/")
        })
        expect(journey.state.status).toBe("checking_url")

        await act(async () => journey.abandonAttempt())
        await act(async () => {
            probe.release({
                count: 1,
                probe: {reachable: true, server_name: "Acme", auth: {mode: "none"}},
            })
            await submitted
        })
        await settle()

        // The name step belongs to the attempt that was abandoned; arriving there now would
        // hand the person a form for a connection they cancelled.
        expect(journey.state.status).toBe("checking_url")
    })

    it("says nothing about a probe that failed for an attempt nobody is waiting for", async () => {
        const probe = deferred<unknown>()
        probeMcpUrl.mockReturnValue(probe.promise)

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        let submitted: Promise<void>
        await act(async () => {
            submitted = journey.submitUrl("https://mcp.acme.test/")
        })

        await act(async () => journey.abandonAttempt())
        await act(async () => {
            probe.reject(new Error("The server did not answer."))
            await submitted.catch(() => undefined)
        })
        await settle()

        // A failure is no more welcome than a success on a dead attempt: it would put an error
        // under a dialog the person has already left.
        expect(journey.state.status).toBe("checking_url")
    })

    it("does not fill a reconnected server's tool list after the dialog moved on", async () => {
        const tools = deferred<unknown>()
        listMcpTools.mockReturnValue(tools.promise)

        await mountReconnectJourney()
        let loaded: Promise<void>
        await act(async () => {
            loaded = journey.loadTools()
        })

        await act(async () => journey.abandonAttempt())
        await act(async () => {
            tools.release([{name: "echo"}])
            await loaded
        })
        await settle()

        expect(journey.state.status).not.toBe("tools_ready")
    })
})

describe("the popup contract", () => {
    it("gives each attempt its own window name", async () => {
        await mountJourney()
        const first = journey.popupName

        await act(async () => root.render(null))
        await mountJourney()

        // A shared name lets a second attempt reuse, and so hijack, the first one's window.
        expect(journey.popupName).not.toBe(first)
        expect(first).toMatch(/^mcp_oauth_/)
    })

    it("says up front whether this server will need a window at all", async () => {
        await mountJourney()
        expect(journey.expectsConsent).toBe(false)

        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })

        // The caller opens the window inside the tap, before any await, and only for a
        // server already known to use OAuth.
        expect(journey.expectsConsent).toBe(true)
    })

    const driveToConsent = async (popup: Window | null) => {
        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()
        await act(async () => {
            await journey.submitScopes(popup)
        })
    }

    it("falls back to this tab when the window was refused", async () => {
        const assign = vi.fn()
        vi.stubGlobal("location", {assign, href: "https://app.example.test/"})

        await driveToConsent(null)

        expect(assign).toHaveBeenCalledWith("https://issuer.test/authorize")
    })

    it("writes down where the tab was before it leaves it", async () => {
        const setItem = vi.fn()
        vi.stubGlobal("location", {
            assign: vi.fn(),
            pathname: "/m/w/ws-1/p/proj-1/settings",
            search: "?tab=mcpEndpoints",
        })
        vi.stubGlobal("sessionStorage", {setItem, getItem: () => null, removeItem: vi.fn()})

        await driveToConsent(null)

        // The callback page knows the deployment's origin and nothing else, so a return that
        // keeps the surface, the workspace and the project has to be recorded here, at the
        // last moment anything knows them (UI QA round 3, D1).
        expect(setItem).toHaveBeenCalledWith(
            "agenta:mcp:return-path",
            "/m/w/ws-1/p/proj-1/settings?tab=mcpEndpoints",
        )
    })

    it("writes nothing down when the window opened, because the app is still standing", async () => {
        const setItem = vi.fn()
        vi.stubGlobal("sessionStorage", {setItem, getItem: () => null, removeItem: vi.fn()})

        await driveToConsent(fakePopup())

        // A stale path would send the next blocked return to wherever this attempt began.
        expect(setItem).not.toHaveBeenCalled()
    })

    it("is listening before it sends the window anywhere", async () => {
        // A provider that answers without a consent screen can be back at the callback before
        // the next statement runs, and the completion it posts then lands on a window with no
        // listener. Nothing recovers from that: the poll only notices a CLOSED popup, which is
        // a failure, so a missed success waits out the three-minute timeout while the
        // connection sits authorized behind it. The mock issuer has no consent screen.
        const order: string[] = []
        const listeners = vi.spyOn(window, "addEventListener").mockImplementation(((
            type: string,
        ) => {
            if (type === "message") order.push("listening")
        }) as never)
        const popup = {
            closed: false,
            close: vi.fn(),
            get location() {
                return {
                    set href(value: string) {
                        if (value) order.push("navigated")
                    },
                }
            },
        } as never

        await driveToConsent(popup)

        expect(order).toEqual(["listening", "navigated"])
        listeners.mockRestore()
    })

    it("trusts only the origin that serves the callback", async () => {
        const listeners = vi.spyOn(window, "addEventListener")
        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()
        await act(async () => {
            await journey.submitScopes(fakePopup())
        })

        // The watch is installed, which is what carries the trusted-origin set.
        expect(listeners.mock.calls.filter(([type]) => type === "message")).toHaveLength(1)

        // A completion from anywhere but the API's own origin is ignored.
        const handler = listeners.mock.calls.find(([type]) => type === "message")?.[1] as (
            event: MessageEvent,
        ) => void
        await act(async () => {
            handler({
                data: {type: "mcp:oauth:connected", success: true, endpoint_id: "mcp-1"},
                origin: "https://evil.test",
            } as MessageEvent)
        })
        expect(journey.state.status).toBe("awaiting_consent")

        await act(async () => {
            handler({
                data: {type: "mcp:oauth:connected", success: true, endpoint_id: "mcp-1"},
                origin: "https://api.example.test",
            } as MessageEvent)
        })
        expect(journey.state.status).toBe("saving")
    })
})

describe("the URL check has an end", () => {
    it("gives up on a server that never answers, and keeps the address", async () => {
        // The check is the first thing anyone does here, and a spinner with no end is
        // indistinguishable from a broken dialog. The probe's own deadline is twice this
        // one, so without a client bound the wait is twenty seconds of nothing.
        //
        // The clock is faked only across the wait itself, and only `setTimeout`: React
        // flushes its own work on the same timers, so a test that fakes them around its
        // render waits on a clock nobody winds.
        probeMcpUrl.mockImplementation(() => new Promise(() => undefined))
        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))

        vi.useFakeTimers({toFake: ["setTimeout"]})
        let submitted: Promise<void>
        try {
            submitted = journey.submitUrl("https://mcp.acme.test/")
            vi.advanceTimersByTime(PROBE_TIMEOUT_MS)
        } finally {
            vi.useRealTimers()
        }
        await act(async () => {
            await submitted
        })

        expect(journey.state.status).toBe("check_failed")
        // The address survives, so Try again does not mean retype.
        expect(journey.state.url).toBe("https://mcp.acme.test/")
        // The probe's own sentence for this, rather than a second wording for one condition.
        expect(journey.state.error).toContain("did not finish answering in time")
        // Nothing was learned, so nothing is claimed: the failure screen falls back to the
        // unreachable wording rather than reading a cause it does not have.
        expect(journey.state.probe).toBeNull()
    })
})
