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
    editMcpEndpoint,
    beginMcpConnect,
    cancelMcpConnectAttempt,
    discoverMcpConnect,
    fetchMcpConnectAttempt,
    listMcpTools,
    queryMcpEndpoints,
} = vi.hoisted(() => ({
    probeMcpUrl: vi.fn(),
    createMcpEndpoint: vi.fn(),
    deleteMcpEndpoint: vi.fn(),
    editMcpEndpoint: vi.fn(),
    beginMcpConnect: vi.fn(),
    cancelMcpConnectAttempt: vi.fn(),
    discoverMcpConnect: vi.fn(),
    fetchMcpConnectAttempt: vi.fn(),
    listMcpTools: vi.fn(),
    queryMcpEndpoints: vi.fn(),
}))

vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    probeMcpUrl,
    createMcpEndpoint,
    deleteMcpEndpoint,
    editMcpEndpoint,
    beginMcpConnect,
    cancelMcpConnectAttempt,
    discoverMcpConnect,
    fetchMcpConnectAttempt,
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

const mountJourney = async (options: Parameters<typeof useMcpConnectJourney>[0] = {}) => {
    const Probe = () => {
        journey = useMcpConnectJourney(options)
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
    beginMcpConnect.mockResolvedValue({
        count: 1,
        redirect_url: "https://issuer.test/authorize",
        attempt_id: "attempt-1",
        expires_in: 600,
    })
    cancelMcpConnectAttempt.mockResolvedValue(undefined)
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

    /** A create that went out and never came back with an answer. */
    const lostAnswer = new Error("network down")

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

    /** Submit the same name again, which is what Try again does. */
    const retryName = async () => {
        await act(async () => {
            await journey.submitName()
        })
        await settle()
    }

    /**
     * The sequence the adoption exists for: a save that landed and lost its answer, then a
     * retry the API refuses because the row from the first one is already there.
     */
    const submitThenRetryAfterALostSave = async () => {
        createMcpEndpoint.mockRejectedValueOnce(lostAnswer)
        createMcpEndpoint.mockRejectedValue(nameTaken)
        await mountJourney()
        await submitNamed()
        await retryName()
    }

    it("continues from the row its own lost save already made", async () => {
        // The first save landed and only its answer was lost, so the retry's create is refused
        // by the row the person already owns. Telling them to rename it is a dead end: the only
        // way forward was to invent a second name for one connection (round 4, D3).
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

        await submitThenRetryAfterALostSave()

        expect(journey.state.status).toBe("discovering_scopes")
        expect(journey.state.endpointId).toBe("mcp-1")
        expect(journey.state.slug).toBe("acme-7mx")
        expect(journey.state.error).toBeNull()
    })

    it("refuses a name the project already uses, however well the address matches", async () => {
        // Nothing of this journey's can be behind a conflict it meets on its first try, so the
        // row is somebody else's connection even though it points at the same server. Taking
        // it over reported a connection as made under a name that was never free, which is
        // what the API refused and the sheet went on to call success (round 6, D-R6-3).
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-9",
                    slug: "acme-someone-else",
                    name: "Acme",
                    auth_mode: "oauth",
                    data: {route: {base_url: "https://mcp.acme.test/"}},
                },
            ],
        })

        await mountJourney()
        await submitNamed()

        expect(journey.state.status).toBe("naming")
        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.error).toContain("already uses this name")
        // The refusal is the answer; the list is not even consulted.
        expect(queryMcpEndpoints).not.toHaveBeenCalled()
    })

    it("keeps refusing it however many times the same name is submitted", async () => {
        // A second press of Connect is not a retry of a lost save: the first press was
        // refused, so it wrote nothing that a later conflict could be.
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-9",
                    slug: "acme-someone-else",
                    name: "Acme",
                    auth_mode: "oauth",
                    data: {route: {base_url: "https://mcp.acme.test/"}},
                },
            ],
        })

        await mountJourney()
        await submitNamed()
        await retryName()

        expect(journey.state.status).toBe("naming")
        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.error).toContain("already uses this name")
    })

    it("does not claim the row it adopted, so cancelling leaves it alone", async () => {
        // The row it found is indistinguishable from one somebody else made a moment earlier.
        // Deleting that on cancel would destroy a connection this journey never created.
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

        await submitThenRetryAfterALostSave()
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

        await submitThenRetryAfterALostSave()

        expect(journey.state.status).toBe("naming")
        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.error).toContain("already uses this name")
    })

    it("leaves the refusal standing when the connection list cannot be read", async () => {
        queryMcpEndpoints.mockRejectedValue(new Error("network down"))

        await submitThenRetryAfterALostSave()

        expect(journey.state.status).toBe("naming")
        expect(journey.state.error).toContain("already uses this name")
    })

    it("forgets the attempt once the name is edited", async () => {
        // The gate used to be a flag, and a flag outlives what set it: a lost save, an edit
        // to the name, and then a conflict on the NEW name was adopted as though it were the
        // lost row. That row is somebody else's connection, and the credential submit that
        // follows writes over it (round 4, D170).
        createMcpEndpoint.mockRejectedValueOnce(lostAnswer)
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-other",
                    slug: "acme-someone-else",
                    name: "Acme renamed",
                    auth_mode: "oauth",
                    data: {route: {base_url: "https://mcp.acme.test/"}},
                },
            ],
        })

        await mountJourney()
        await submitNamed()
        // The person renames it and tries again; the conflict is now on a name this journey
        // has never successfully sent.
        await act(async () => journey.setName("Acme renamed"))
        await retryName()

        expect(journey.state.status).toBe("naming")
        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.error).toContain("already uses this name")
    })

    it("forgets it when the address is edited too", async () => {
        createMcpEndpoint.mockRejectedValueOnce(lostAnswer)
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-other",
                    slug: "acme-someone-else",
                    name: "Acme",
                    auth_mode: "oauth",
                    data: {route: {base_url: "https://mcp.elsewhere.test/"}},
                },
            ],
        })

        await mountJourney()
        await submitNamed()
        await act(async () => journey.setUrl("https://mcp.elsewhere.test/"))
        await retryName()

        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.error).toContain("already uses this name")
    })

    it("never opens the question on a failure the server answered", async () => {
        // A status is the server saying it did not write the row, so a later conflict cannot
        // be this attempt's. Only a failure nothing answered leaves it open.
        createMcpEndpoint.mockRejectedValueOnce({
            response: {status: 400, data: {detail: "Bad request."}},
        })
        createMcpEndpoint.mockRejectedValue(nameTaken)
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-1",
                    slug: "acme-7mx",
                    name: "Acme",
                    auth_mode: "oauth",
                    data: {route: {base_url: "https://mcp.acme.test/"}},
                },
            ],
        })

        await mountJourney()
        await submitNamed()
        await retryName()

        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.error).toContain("already uses this name")
    })

    it("asks nothing extra when the save simply succeeds", async () => {
        await mountJourney()
        await submitNamed()

        expect(queryMcpEndpoints).not.toHaveBeenCalled()
        expect(journey.state.endpointId).toBe("mcp-1")
    })
})

describe("leaving one address for another", () => {
    it("deletes the row it made and connects the new address to a new one", async () => {
        // The row was kept and the next submit continued from it, so the connection reported
        // as made pointed at the address the person had left (round 4, D111). Deleting it is
        // what `cancel` already does for a pending row this journey created.
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
        expect(journey.state.endpointId).toBe("mcp-1")

        await act(async () => journey.setUrl("https://mcp.elsewhere.test/"))
        await settle()

        expect(deleteMcpEndpoint).toHaveBeenCalledWith("mcp-1", "project-1", "oauth")
        expect(journey.state.endpointId).toBeNull()

        createMcpEndpoint.mockResolvedValue({
            count: 1,
            endpoint: {id: "mcp-2", slug: "elsewhere", name: "Acme", auth_mode: "oauth"},
        })
        await act(async () => {
            await journey.submitUrl("https://mcp.elsewhere.test/")
        })
        await act(async () => {
            await journey.submitName()
        })
        await settle()

        // A new row for the new address, rather than the one that was left behind.
        expect(journey.state.endpointId).toBe("mcp-2")
    })

    it("keeps the row when the address is re-entered unchanged", async () => {
        // Pressing Change and typing nothing must not throw away a row that is still right.
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

        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await settle()

        expect(deleteMcpEndpoint).not.toHaveBeenCalled()
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
})

describe("the server-side consent attempt", () => {
    const reachConsent = async (popup: Window | null) => {
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

    it("cancels the attempt on the server when the person cancels the consent", async () => {
        await reachConsent(fakePopup())

        await act(async () => journey.cancelConsent())

        // Otherwise a late callback still exchanges its code and binds the grant.
        expect(cancelMcpConnectAttempt).toHaveBeenCalledWith("mcp-1", "attempt-1", "project-1")
    })

    it("cancels the attempt when the whole journey is cancelled", async () => {
        await reachConsent(fakePopup())

        await act(async () => {
            await journey.cancel()
        })

        expect(cancelMcpConnectAttempt).toHaveBeenCalledWith("mcp-1", "attempt-1", "project-1")
    })

    it("lets the server keep a pending row that another tab took over", async () => {
        // Another tab reconnected the row with a key while this sheet waited. Which row goes
        // is decided under the connection's lock, so the delete names the mode this sheet
        // made the row in, and the server's refusal ends the cancel quietly.
        await reachConsent(fakePopup())
        deleteMcpEndpoint.mockRejectedValueOnce({response: {status: 409}})

        await act(async () => {
            await journey.cancel()
        })

        expect(deleteMcpEndpoint).toHaveBeenCalledWith("mcp-1", "project-1", "oauth")
        expect(cancelMcpConnectAttempt).toHaveBeenCalledWith("mcp-1", "attempt-1", "project-1")
    })

    it("cancels the last attempt when a new window replaces it", async () => {
        await reachConsent(fakePopup())
        await act(async () => journey.cancelConsent())
        cancelMcpConnectAttempt.mockClear()
        beginMcpConnect.mockResolvedValueOnce({
            count: 1,
            redirect_url: "https://issuer.test/authorize",
            attempt_id: "attempt-2",
            expires_in: 600,
        })

        await act(async () => {
            await journey.submitScopes(fakePopup())
        })
        await act(async () => journey.cancelConsent())

        expect(cancelMcpConnectAttempt).toHaveBeenCalledTimes(1)
        expect(cancelMcpConnectAttempt).toHaveBeenCalledWith("mcp-1", "attempt-2", "project-1")
    })

    it("cancels nothing once the attempt succeeded", async () => {
        const listeners = vi.spyOn(window, "addEventListener")
        await reachConsent(fakePopup())
        const handler = listeners.mock.calls.find(([type]) => type === "message")?.[1] as (
            event: MessageEvent,
        ) => void
        await act(async () => {
            handler({
                data: {type: "mcp:oauth:connected", success: true, attempt_id: "attempt-1"},
                origin: "https://api.example.test",
            } as MessageEvent)
        })

        await act(async () => journey.abandonAttempt())

        expect(cancelMcpConnectAttempt).not.toHaveBeenCalled()
        listeners.mockRestore()
    })

    it("asks the server how the attempt ended when the window closes without a message", async () => {
        vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]})
        fetchMcpConnectAttempt.mockResolvedValue({
            count: 1,
            attempt: {id: "attempt-1", status: "failed", error: "User declined"},
        })
        const popup = {closed: false, close: vi.fn(), location: {href: ""}}
        await reachConsent(popup as never)

        popup.closed = true
        await act(async () => {
            vi.advanceTimersByTime(1_000)
        })
        await settle()

        expect(fetchMcpConnectAttempt).toHaveBeenCalledWith("mcp-1", "attempt-1", "project-1")
        // The provider's words, not "window closed".
        expect(journey.state.error).toBe("User declined")
        vi.useRealTimers()
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
                data: {
                    type: "mcp:oauth:connected",
                    success: true,
                    endpoint_id: "mcp-1",
                    attempt_id: "attempt-1",
                },
                origin: "https://evil.test",
            } as MessageEvent)
        })
        expect(journey.state.status).toBe("awaiting_consent")

        await act(async () => {
            handler({
                data: {
                    type: "mcp:oauth:connected",
                    success: true,
                    endpoint_id: "mcp-1",
                    attempt_id: "attempt-1",
                },
                origin: "https://api.example.test",
            } as MessageEvent)
        })
        expect(journey.state.status).toBe("saving")
    })
})

describe("the URL check has an end", () => {
    it("gives up on a server that never answers, and keeps the address", async () => {
        // The check is the first thing anyone does here, and a spinner with no end is
        // indistinguishable from a broken dialog.
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

describe("an address that answered with something other than a handshake", () => {
    it("stops at the address rather than asking for a key", async () => {
        // The address was reached, so `reachable` is true. Routing on that alone sent a
        // 404 or a redirect to the key screen, asking for a credential no server would use.
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                auth: {mode: "unknown"},
                problem: {
                    cause: "not_an_mcp_server",
                    message: "The address answered, but not with an MCP handshake (HTTP 404).",
                    response: {status: 404, body: "<html>Not Found</html>"},
                },
            },
        })

        await mountJourney()
        await act(async () => journey.setUrl("https://acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://acme.test/")
        })

        expect(journey.state.status).toBe("check_failed")
        expect(journey.state.error).toBe(
            "The address answered, but not with an MCP handshake (HTTP 404).",
        )
        expect(journey.state.probe?.problem?.cause).toBe("not_an_mcp_server")
        expect(createMcpEndpoint).not.toHaveBeenCalled()
    })
})

describe("an address on the legacy SSE transport", () => {
    it("stops at the address once the probe proved the transport", async () => {
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                auth: {mode: "unknown"},
                problem: {
                    cause: "unsupported_transport",
                    message:
                        "This address uses the older SSE transport, which Agenta does not support.",
                    response: {status: 405, body: "Method Not Allowed"},
                },
            },
        })

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/events"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/events")
        })

        expect(journey.state.status).toBe("check_failed")
        expect(journey.state.probe?.problem?.cause).toBe("unsupported_transport")
        expect(createMcpEndpoint).not.toHaveBeenCalled()
    })

    it("goes on to sign in where the address only suggests it", async () => {
        // A Streamable HTTP server may live at an /sse address. A 401 there proves nothing,
        // so the probe warns and the journey carries on to credential entry.
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                auth: {mode: "unknown", challenge_status: 401, challenge_schemes: ["Bearer"]},
                legacy_transport_suspected: true,
                problem: {
                    cause: "auth_undiscoverable",
                    message: "The server requires authorization.",
                },
            },
        })

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/sse"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/sse")
        })

        expect(journey.state.status).not.toBe("check_failed")
        expect(journey.state.probe?.legacy_transport_suspected).toBe(true)
    })
})

describe("a credential the server refused", () => {
    it("takes the row away with it, so nothing reports itself connected", async () => {
        // The row carries a secret that does not work, and the registry has no health field
        // to say so, so it sat in the list reading Connected while its own detail said the
        // server had not answered (round 6d, live).
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {reachable: true, server_name: "Axiom", auth: {mode: "unknown"}},
        })
        editMcpEndpoint.mockResolvedValue({count: 1, endpoint: {id: "mcp-1", slug: "acme-7mx"}})
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-1",
                    slug: "acme-7mx",
                    name: "Axiom",
                    auth_mode: "api_key",
                    data: {route: {base_url: "https://mcp.acme.test/"}},
                },
            ],
        })
        listMcpTools.mockRejectedValue({
            response: {status: 401, data: {detail: "The server rejected this key."}},
        })

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Axiom"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()
        expect(journey.state.endpointId).toBe("mcp-1")

        await act(async () => {
            await journey.submitManualCredential({
                binding: {kind: "header", name: "X-Api-Key"},
                secretId: "wrong",
            })
        })
        await settle()

        expect(journey.state.status).toBe("verify_failed")
        expect(deleteMcpEndpoint).toHaveBeenCalledWith("mcp-1", "project-1")
        // And nothing is left pointing at it, so a retry makes a fresh row rather than
        // writing another credential onto the one that was refused.
        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.createdHere).toBe(false)
    })
})

describe("a pasted address that already carries the key", () => {
    it("keeps the bound query parameter out of the stored row, on create and on edit", async () => {
        // The relay adds the parameter at request time. Copying the pasted URL into the row
        // kept the key in plain text in the endpoint's `base_url` (Codex review, PR 5).
        const pasted = "https://mcp.exa.test/mcp?exaApiKey=test-key-one&debug=on"
        const stored = "https://mcp.exa.test/mcp?debug=on"
        const binding = {kind: "query" as const, name: "exaApiKey"}
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {reachable: true, server_name: "Exa", auth: {mode: "none"}},
        })
        editMcpEndpoint.mockResolvedValue({count: 1, endpoint: {id: "mcp-1", slug: "exa"}})
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-1",
                    slug: "exa",
                    name: "Exa",
                    auth_mode: "api_key",
                    data: {route: {base_url: stored}},
                },
            ],
        })
        listMcpTools.mockResolvedValue({tools: []})

        await mountJourney()
        await act(async () => journey.setUrl(pasted))
        await act(async () => {
            await journey.submitUrl(pasted)
        })
        await act(async () => journey.setName("Exa"))
        await act(async () => journey.selectAuthMode("api_key"))
        await act(async () => {
            await journey.submitName(binding)
        })
        expect(createMcpEndpoint.mock.calls.at(-1)?.[0].data.route.base_url).toBe(stored)

        await act(async () => {
            await journey.submitManualCredential({binding, secretId: "sec-1"})
        })
        const route = editMcpEndpoint.mock.calls.at(-1)?.[0].data.route
        expect(route.base_url).toBe(stored)
        expect(route.credential_binding).toEqual({...binding, prefix: null})
    })
})

describe("an address with {secret}", () => {
    // Firecrawl takes the key as a path segment. The address does not exist without it, so
    // it is checked with the chosen secret, named by its id, and never anonymously.
    const firecrawl = "https://mcp.firecrawl.dev/{secret}/v2/mcp"
    const binding = {kind: "url" as const}

    const submitFirecrawl = async () => {
        await mountJourney()
        await act(async () => journey.setUrl(firecrawl))
        await act(async () => {
            await journey.submitUrl(firecrawl)
        })
    }

    it("skips the anonymous check and asks for the key", async () => {
        await submitFirecrawl()

        expect(probeMcpUrl).not.toHaveBeenCalled()
        expect(journey.state.status).toBe("naming")
        expect(journey.state.authMode).toBe("api_key")
    })

    it("checks the address with the chosen secret, then stores it with the placeholder", async () => {
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {reachable: true, server_name: "Firecrawl", auth: {mode: "none"}},
        })
        await submitFirecrawl()
        await act(async () => {
            await journey.submitName(binding, "sec-1")
        })

        expect(probeMcpUrl).toHaveBeenCalledWith(firecrawl, "project-1", "sec-1", binding)
        const route = createMcpEndpoint.mock.calls.at(-1)?.[0].data.route
        expect(route).toEqual({base_url: firecrawl, credential_binding: binding})
        expect(journey.state.status).toBe("manual_auth")
    })

    it("reads a server still asking for authorization as a refused key, and makes no row", async () => {
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                auth: {mode: "unknown", challenge_status: 401, challenge_schemes: []},
                problem: {cause: "auth_undiscoverable", message: "requires authorization"},
            },
        })
        await submitFirecrawl()
        await act(async () => {
            await journey.submitName(binding, "sec-1")
        })

        expect(createMcpEndpoint).not.toHaveBeenCalled()
        expect(journey.state.status).toBe("verify_failed")
        expect(journey.state.failureStatus).toBe(401)
    })
})

describe("the authentication the person selects", () => {
    // The probe found OAuth (the default stub). The person's choice is what the row is
    // created in, and the probe is only where the choice started.
    const probed = async () => {
        await mountJourney()
        await act(async () => journey.setUrl("https://api.githubcopilot.test/mcp"))
        await act(async () => {
            await journey.submitUrl("https://api.githubcopilot.test/mcp")
        })
        await act(async () => journey.setName("GitHub"))
    }

    it("creates the row with a key on a server whose probe found OAuth", async () => {
        await probed()
        expect(journey.state.authMode).toBe("oauth")

        await act(async () => journey.selectAuthMode("api_key"))
        await act(async () => {
            await journey.submitName()
        })

        expect(createMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({auth_mode: "api_key"}),
            "project-1",
        )
        expect(journey.state.status).toBe("manual_auth")
        expect(journey.expectsConsent).toBe(false)
        expect(discoverMcpConnect).not.toHaveBeenCalled()
    })

    it("deletes the pending row made in the old mode", async () => {
        await probed()
        await act(async () => {
            await journey.submitName()
        })
        expect(createMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({auth_mode: "oauth"}),
            "project-1",
        )

        await act(async () => journey.selectAuthMode("none"))
        await settle()

        expect(deleteMcpEndpoint).toHaveBeenCalledWith("mcp-1", "project-1", "oauth")
        expect(journey.state.status).toBe("naming")
        expect(journey.state.endpointId).toBeNull()
    })

    it("switches a saved connection on its own row, keeping its tools and its secret", async () => {
        // The detail panel reaches this through Reconnect. The row's id, slug and tool filter
        // stay, and the vault secret is let go rather than deleted.
        const stored = {
            id: "mcp-9",
            slug: "github",
            name: "GitHub",
            auth_mode: "oauth",
            secret_id: "grant-1",
            data: {
                route: {base_url: "https://api.githubcopilot.test/mcp"},
                tools: {allowlist: ["search"]},
            },
            flags: {is_valid: true},
        }
        queryMcpEndpoints.mockResolvedValue({count: 1, endpoints: [stored]})
        editMcpEndpoint.mockResolvedValue({count: 1, endpoint: stored})

        await mountJourney({
            reconnect: {
                id: "mcp-9",
                slug: "github",
                name: "GitHub",
                url: "https://api.githubcopilot.test/mcp",
                authMode: "oauth",
            },
        })
        // The saved address publishes OAuth, so None is checked: asked without a key, the
        // server answers.
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {reachable: true, server_name: "GitHub", auth: {mode: "none"}},
        })
        await act(async () => journey.selectAuthMode("none"))
        expect(journey.state.status).toBe("manual_auth")
        await act(async () => {
            await journey.skipAuthentication()
        })

        // No secret and no binding: the check asks for a handshake without a key.
        expect(probeMcpUrl).toHaveBeenLastCalledWith(
            "https://api.githubcopilot.test/mcp",
            "project-1",
            undefined,
            undefined,
        )
        expect(editMcpEndpoint).toHaveBeenCalledWith(
            {...stored, auth_mode: "none", secret_id: null},
            "project-1",
        )
        expect(deleteMcpEndpoint).not.toHaveBeenCalled()
        expect(journey.state.status).toBe("saving")
    })

    it("writes nothing when the sheet closes while the saved row is being read", async () => {
        const read = deferred<unknown>()
        queryMcpEndpoints.mockReturnValue(read.promise)

        await mountJourney({
            reconnect: {
                id: "mcp-9",
                slug: "github",
                name: "GitHub",
                url: "https://api.githubcopilot.test/mcp",
                authMode: "api_key",
            },
        })
        await act(async () => journey.selectAuthMode("none"))
        let skipped: Promise<void> = Promise.resolve()
        await act(async () => {
            skipped = journey.skipAuthentication()
        })
        await act(async () => {
            await journey.cancel()
        })
        await act(async () => {
            read.release({
                count: 1,
                endpoints: [
                    {
                        id: "mcp-9",
                        slug: "github",
                        auth_mode: "api_key",
                        secret_id: "key-1",
                        data: {route: {base_url: "https://api.githubcopilot.test/mcp"}},
                    },
                ],
            })
            await skipped
        })

        expect(editMcpEndpoint).not.toHaveBeenCalled()
        expect(listMcpTools).not.toHaveBeenCalled()
    })
})

describe("None chosen over what the server suggested", () => {
    const refused = Object.assign(new Error("Request failed with status code 401"), {
        response: {status: 401, data: {detail: "The server requires authorization."}},
    })

    it("asks the server before success, and keeps the sheet open on its refusal", async () => {
        // The probe found OAuth. Choosing None is a claim only the server can confirm.
        listMcpTools.mockRejectedValue(refused)
        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        await act(async () => journey.selectAuthMode("none"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()

        expect(createMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({auth_mode: "none"}),
            "project-1",
        )
        expect(listMcpTools).toHaveBeenCalledWith("acme-7mx", "project-1")
        expect(journey.state.status).toBe("verify_failed")
        expect(journey.state.failureStatus).toBe(401)
        // The pending row made for a connection that does not work goes with the refusal.
        expect(deleteMcpEndpoint).toHaveBeenCalledWith("mcp-1", "project-1")
    })

    it("needs no second asking where the probe found no sign-in", async () => {
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {reachable: true, server_name: "Acme", auth: {mode: "none", scopes_offered: []}},
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

        expect(listMcpTools).not.toHaveBeenCalled()
        expect(journey.state.status).toBe("saving")
    })
})

describe("the OAuth app the person entered", () => {
    const connectWith = async (client?: {
        clientId?: string
        clientSecretId?: string | null
        authMethod?: "client_secret_basic" | "client_secret_post" | "none"
    }) => {
        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        if (client) await act(async () => journey.setOauthClient(client))
        await act(async () => {
            await journey.submitName()
        })
        await settle()
        await act(async () => {
            await journey.submitScopes(fakePopup())
        })
    }

    it("goes with the row's first write, before the provider is asked", async () => {
        await connectWith({clientId: "app-from-github", clientSecretId: "secret-1"})

        expect(createMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    oauth_config: {
                        client_id: "app-from-github",
                        client_secret_id: "secret-1",
                        token_endpoint_auth_method: "client_secret_post",
                        scopes: [],
                    },
                }),
            }),
            "project-1",
        )
        expect(beginMcpConnect).toHaveBeenCalledOnce()
    })

    it("writes nothing when the row already holds what is on screen", async () => {
        // The probe and the discovery offer the same scopes, so the settings the create
        // sent are the settings consent uses.
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                server_name: "Acme",
                auth: {mode: "oauth", scopes_offered: ["tools:list"]},
            },
        })

        await connectWith()

        expect(createMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    oauth_config: {
                        client_id: null,
                        client_secret_id: null,
                        token_endpoint_auth_method: null,
                        scopes: ["tools:list"],
                    },
                }),
            }),
            "project-1",
        )
        expect(queryMcpEndpoints).not.toHaveBeenCalled()
        expect(editMcpEndpoint).not.toHaveBeenCalled()
        expect(beginMcpConnect).toHaveBeenCalledOnce()
    })

    it("saves a Basic-authenticated app with its secret, and a changed secret again", async () => {
        const row = {
            id: "mcp-1",
            slug: "acme-7mx",
            name: "Acme",
            auth_mode: "oauth",
            data: {route: {base_url: "https://mcp.acme.test/"}},
        }
        queryMcpEndpoints.mockResolvedValue({count: 1, endpoints: [row]})
        editMcpEndpoint.mockResolvedValue({count: 1, endpoint: row})

        await connectWith({
            clientId: "app-from-github",
            clientSecretId: "secret-1",
            authMethod: "client_secret_basic",
        })
        const saved = (config: Record<string, unknown>) =>
            expect(editMcpEndpoint).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({oauth_config: config}),
                }),
                "project-1",
            )
        expect(createMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    oauth_config: {
                        client_id: "app-from-github",
                        client_secret_id: "secret-1",
                        token_endpoint_auth_method: "client_secret_basic",
                        scopes: [],
                    },
                }),
            }),
            "project-1",
        )
        expect(editMcpEndpoint).not.toHaveBeenCalled()

        await act(async () => journey.setOauthClient({clientSecretId: "secret-2"}))
        await act(async () => {
            await journey.submitScopes(fakePopup())
        })
        saved({
            client_id: "app-from-github",
            client_secret_id: "secret-2",
            token_endpoint_auth_method: "client_secret_basic",
            scopes: [],
        })
    })
})
