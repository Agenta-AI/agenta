/**
 * The addresses other screens use to open the playground: the URL builders, and the trace
 * drawer's span-to-address step. The trace step decodes its own hash here, so a link that a
 * reload or a colleague opens restores the same thing.
 */
import type {TraceSpanNode} from "@agenta/entities/trace"
import {isDrawerOpenAtom, openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {parseSnapshot} from "@agenta/playground/snapshot"
import {getDefaultStore} from "jotai"
import type {NextRouter} from "next/router"
import {describe, expect, it, vi} from "vitest"

import {
    openTraceInPlayground,
    resolveTracePlaygroundTarget,
    tracePlaygroundTarget,
} from "@/features/observability/tracePlayground"
import {
    evaluatorPlaygroundHref,
    parseRevisionIds,
    playgroundHref,
    readSnapshotParam,
    withSnapshot,
} from "@/features/playground/playgroundUrl"

const BASE = "/w/ws-1/p/proj-1"

describe("playground links", () => {
    it("The app playground address names the app and the revisions in order", () => {
        expect(playgroundHref(BASE, "app-1")).toBe("/w/ws-1/p/proj-1/apps/app-1/playground")
        expect(playgroundHref(BASE, "app-1", ["rev-2", "rev-1"])).toBe(
            "/w/ws-1/p/proj-1/apps/app-1/playground?revisions=rev-2,rev-1",
        )
    })

    it("The evaluator playground address names the evaluator revision", () => {
        expect(evaluatorPlaygroundHref(BASE, "ev-rev-1")).toBe(
            "/w/ws-1/p/proj-1/evaluators/playground?revisions=ev-rev-1",
        )
    })

    it("A snapshot rides in the hash and reads back unchanged", () => {
        const href = withSnapshot(playgroundHref(BASE, "app-1", ["rev-1"]), "Abc+d-e$")
        expect(href).toBe(
            "/w/ws-1/p/proj-1/apps/app-1/playground?revisions=rev-1#pgSnapshot=Abc+d-e$",
        )
        expect(readSnapshotParam("#pgSnapshot=Abc+d-e$")).toBe("Abc+d-e$")
        expect(readSnapshotParam("#other=1&pgSnapshot=xyz")).toBe("xyz")
        expect(readSnapshotParam("")).toBeNull()
        expect(readSnapshotParam("#pgSnapshot=")).toBeNull()
    })

    it("Repeated revision ids are read once", () => {
        expect(parseRevisionIds("rev-1,rev-1,,rev-2")).toEqual(["rev-1", "rev-2"])
    })
})

const span = (overrides: Partial<TraceSpanNode>): TraceSpanNode =>
    ({
        trace_id: "trace-1",
        span_id: "span-1",
        span_type: "workflow",
        span_name: "generate",
        attributes: {ag: {data: {inputs: {country: "Peru"}}}},
        ...overrides,
    }) as TraceSpanNode

describe("tracePlaygroundTarget", () => {
    it("An app trace opens its revision with the trace inputs as one test case", () => {
        const target = tracePlaygroundTarget({
            base: BASE,
            span: span({}),
            refs: {appId: "app-1", revisionId: "rev-1"},
        })
        expect(target.kind).toBe("link")
        if (target.kind !== "link") return

        const [path, hash] = target.href.split("#pgSnapshot=")
        expect(path).toBe("/w/ws-1/p/proj-1/apps/app-1/playground?revisions=rev-1")
        const snapshot = parseSnapshot(hash)
        expect(snapshot.ok).toBe(true)
        expect(snapshot.value?.selection).toEqual([
            {kind: "commit", id: "rev-1", runnableType: "workflow"},
        ])
        expect(snapshot.value?.localTestset?.rows).toEqual([{data: {country: "Peru"}}])
    })

    it("Nested inputs and chat messages become the test case", () => {
        const target = tracePlaygroundTarget({
            base: BASE,
            span: span({
                attributes: {
                    ag: {
                        data: {
                            inputs: {
                                inputs: {topic: "tea"},
                                messages: [{role: "user", content: "Hi"}],
                                parameters: {temperature: 1},
                            },
                        },
                    },
                },
            }),
            refs: {appId: "app-1", revisionId: "rev-1"},
        })
        if (target.kind !== "link") throw new Error("expected a link")
        const snapshot = parseSnapshot(target.href.split("#pgSnapshot=")[1])
        expect(snapshot.value?.localTestset?.rows).toEqual([
            {data: {topic: "tea", messages: [{role: "user", content: "Hi"}]}},
        ])
    })

    it("A trace with no inputs opens the revision with no hash", () => {
        const target = tracePlaygroundTarget({
            base: BASE,
            span: span({attributes: {}}),
            refs: {appId: "app-1", revisionId: "rev-1"},
        })
        expect(target).toEqual({
            kind: "link",
            href: "/w/ws-1/p/proj-1/apps/app-1/playground?revisions=rev-1",
        })
    })

    it("An agent trace opens the agent chat", () => {
        const target = tracePlaygroundTarget({
            base: BASE,
            span: span({span_type: "agent"}),
            refs: {appId: "agent-1", revisionId: "rev-a"},
        })
        expect(target).toEqual({
            kind: "link",
            href: "/w/ws-1/p/proj-1/agents/agent-1?open=playground",
        })
    })

    it("A trace with no app revision cannot open", () => {
        expect(
            tracePlaygroundTarget({
                base: BASE,
                span: span({}),
                refs: {appId: null, revisionId: null},
            }),
        ).toEqual({kind: "no-app"})
        expect(
            tracePlaygroundTarget({
                base: BASE,
                span: span({}),
                refs: {appId: "app-1", revisionId: null},
            }),
        ).toEqual({kind: "no-app"})
    })

    it("A prompt template among the inputs stays out of the test case", () => {
        const target = tracePlaygroundTarget({
            base: BASE,
            span: span({
                attributes: {
                    ag: {
                        data: {
                            inputs: {
                                topic: "tea",
                                prompt: {
                                    messages: [{role: "system", content: "Be brief"}],
                                    template_format: "curly",
                                },
                            },
                        },
                    },
                },
            }),
            refs: {appId: "app-1", revisionId: "rev-1"},
        })
        if (target.kind !== "link") throw new Error("expected a link")
        const snapshot = parseSnapshot(target.href.split("#pgSnapshot=")[1])
        expect(snapshot.value?.localTestset?.rows).toEqual([{data: {topic: "tea"}}])
    })

    it("A chat span names its type and opens nothing", () => {
        expect(
            tracePlaygroundTarget({
                base: BASE,
                span: span({span_type: "chat"}),
                refs: {appId: "app-1", revisionId: "rev-1"},
            }),
        ).toEqual({kind: "span-type", spanType: "chat"})
    })
})

describe("resolveTracePlaygroundTarget", () => {
    it("An evaluator span opens its revision in the evaluator playground", async () => {
        const target = await resolveTracePlaygroundTarget({
            base: BASE,
            projectId: "proj-1",
            span: span({
                attributes: {
                    ag: {
                        data: {inputs: {country: "Peru"}},
                        references: {evaluator_revision: {id: "ev-rev-1"}},
                    },
                },
            }),
        })
        expect(target).toEqual({
            kind: "link",
            href: "/w/ws-1/p/proj-1/evaluators/playground?revisions=ev-rev-1",
        })
    })

    it("An app span with both ids opens without asking the server", async () => {
        const target = await resolveTracePlaygroundTarget({
            base: BASE,
            projectId: "proj-1",
            span: span({
                attributes: {
                    ag: {
                        data: {},
                        references: {
                            application: {id: "app-1"},
                            application_revision: {id: "rev-1"},
                        },
                    },
                },
            }),
        })
        expect(target).toEqual({
            kind: "link",
            href: "/w/ws-1/p/proj-1/apps/app-1/playground?revisions=rev-1",
        })
    })
})

describe("openTraceInPlayground", () => {
    it("The drawer stays open until the playground page shows", async () => {
        const store = getDefaultStore()
        store.set(openTraceDrawerAtom, {traceId: "trace-1"})
        let finish: (done: boolean) => void = () => undefined
        const push = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
        const router = {query: {workspace_id: "ws-1", project_id: "proj-1"}, push}

        await openTraceInPlayground(
            router as unknown as NextRouter,
            span({
                attributes: {ag: {data: {}, references: {evaluator_revision: {id: "ev-rev-1"}}}},
            }),
        )

        expect(push).toHaveBeenCalledWith(
            "/w/ws-1/p/proj-1/evaluators/playground?revisions=ev-rev-1",
        )
        // Closing now would clear `?trace` and cancel the navigation while the page loads.
        expect(store.get(isDrawerOpenAtom)).toBe(true)
        finish(true)
        await vi.waitFor(() => expect(store.get(isDrawerOpenAtom)).toBe(false))
    })
})
