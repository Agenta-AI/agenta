// @vitest-environment jsdom
/**
 * The sharing dialogs name a disclosed account by the tool catalog's display name for its
 * integration, then the app's provider table. Never the gateway (`composio`), and no slug while
 * a name may still come: the dialogs wait while the catalog loads, and show their load error
 * when it failed for an integration the provider table cannot name. A catalog that answered
 * without a name leaves the title-cased slug.
 */
import {act} from "react"

import type {ShareDisclosure} from "@agenta/entities/sharing"
import {QueryClient} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The catalog read the connect drawer makes: answered from the cache seeded below, else by
// `catalog.answer` (never answering by default).
const catalog = vi.hoisted(() => ({
    answer: (_integration: string): Promise<unknown> => new Promise(() => undefined),
}))
vi.mock("@agenta/entities/gatewayTool", async () => {
    const {atomFamily} = await import("jotai-family")
    const {atomWithQuery} = await import("jotai-tanstack-query")
    return {
        toolIntegrationDetailQueryFamily: atomFamily((integration: string) =>
            atomWithQuery(() => ({
                queryKey: ["tools", "catalog", "integrationDetail", "composio", integration],
                queryFn: () => catalog.answer(integration),
                staleTime: Infinity,
                retry: false,
            })),
        ),
    }
})

import {useDisclosureProviderLabel} from "@/features/chat/useDisclosureProviderLabel"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const disclosure: ShareDisclosure = {
    connections: [
        {provider: "composio", integration: "gmail_v2", connection: "c1"},
        {provider: "composio", integration: "github", connection: "c2"},
        {provider: "composio", integration: "acme_crm", connection: "c3"},
    ],
    turns_use_run_credentials: true,
    files_and_tool_results_shared: true,
    trace_readers_can_read: true,
}

let host: HTMLDivElement
let root: Root
let seen: {labels: string[]; pending: boolean; failed: boolean; retry: () => void}

const Probe = () => {
    const result = useDisclosureProviderLabel(disclosure)
    seen = {...result, labels: disclosure.connections.map(result.label)}
    return null
}

const detailKey = (integration: string) => [
    "tools",
    "catalog",
    "integrationDetail",
    "composio",
    integration,
]

/** Let the catalog answers land and their (batched) notifications render. */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))))

const mount = async (seed: Record<string, string>) => {
    const client = new QueryClient()
    for (const [integration, name] of Object.entries(seed)) {
        client.setQueryData(detailKey(integration), {integration: {key: integration, name}})
    }
    const store = createStore()
    store.set(queryClientAtom, client)
    await act(async () =>
        root.render(
            <Provider store={store}>
                <Probe />
            </Provider>,
        ),
    )
}

beforeEach(() => {
    catalog.answer = () => new Promise(() => undefined)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the disclosure's account names", () => {
    it("are the catalog's display names", async () => {
        await mount({gmail_v2: "Gmail", github: "GitHub", acme_crm: "Acme CRM"})

        expect(seen.labels).toEqual(["Gmail", "GitHub", "Acme CRM"])
        expect(seen.pending).toBe(false)
        expect(seen.failed).toBe(false)
    })

    it("are not ready while a catalog name is still loading", async () => {
        await mount({gmail_v2: "Gmail"})

        expect(seen.pending).toBe(true)
    })

    it("fall back to the provider table when the catalog read failed", async () => {
        catalog.answer = async (integration) => {
            if (integration === "github") throw new Error("catalog down")
            return {integration: {key: integration, name: "Acme CRM"}}
        }
        await mount({gmail_v2: "Gmail"})
        await settle()

        expect(seen.labels).toEqual(["Gmail", "GitHub", "Acme CRM"])
        expect(seen.pending).toBe(false)
        expect(seen.failed).toBe(false)
    })

    it("fail, with a retry, when neither the catalog nor the provider table can name one", async () => {
        let calls = 0
        catalog.answer = async (integration) => {
            if (integration === "acme_crm") {
                calls += 1
                if (calls === 1) throw new Error("catalog down")
                return {integration: {key: integration, name: "Acme CRM"}}
            }
            return {integration: {key: integration, name: "GitHub"}}
        }
        await mount({gmail_v2: "Gmail"})
        await settle()

        expect(seen.pending).toBe(false)
        expect(seen.failed).toBe(true)

        await act(async () => seen.retry())
        await settle()
        expect(seen.failed).toBe(false)
        expect(seen.labels).toEqual(["Gmail", "GitHub", "Acme CRM"])
    })

    it("are the title-cased slug only when the catalog answered without a name", async () => {
        catalog.answer = async (integration) => ({integration: {key: integration, name: ""}})
        await mount({gmail_v2: "Gmail", github: "GitHub"})
        await settle()

        expect(seen.labels).toEqual(["Gmail", "GitHub", "Acme crm"])
        expect(seen.pending).toBe(false)
        expect(seen.failed).toBe(false)
    })
})
