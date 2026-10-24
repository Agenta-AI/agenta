// @vitest-environment jsdom
/**
 * The sharing dialogs name a disclosed account by the tool catalog's display name for its
 * integration. Without a catalog entry the app's provider table answers, and without that the
 * title-cased integration slug. Never the gateway (`composio`).
 */
import {act} from "react"

import type {ShareDisclosure} from "@agenta/entities/sharing"
import {QueryClient} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The catalog read the connect drawer makes; answered from the cache seeded below, or not at all.
vi.mock("@agenta/entities/gatewayTool", async () => {
    const {atomFamily} = await import("jotai-family")
    const {atomWithQuery} = await import("jotai-tanstack-query")
    return {
        toolIntegrationDetailQueryFamily: atomFamily((integration: string) =>
            atomWithQuery(() => ({
                queryKey: ["tools", "catalog", "integrationDetail", "composio", integration],
                queryFn: () => new Promise(() => undefined),
                staleTime: Infinity,
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
let labels: string[] = []

const Probe = () => {
    const label = useDisclosureProviderLabel(disclosure)
    labels = disclosure.connections.map(label)
    return null
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the disclosure's account names", () => {
    it("are the catalog's names, then the provider table, then the title-cased slug", async () => {
        const client = new QueryClient()
        client.setQueryData(["tools", "catalog", "integrationDetail", "composio", "gmail_v2"], {
            integration: {key: "gmail_v2", name: "Gmail"},
        })
        const store = createStore()
        store.set(queryClientAtom, client)

        await act(async () =>
            root.render(
                <Provider store={store}>
                    <Probe />
                </Provider>,
            ),
        )

        expect(labels).toEqual(["Gmail", "GitHub", "Acme crm"])
    })
})
