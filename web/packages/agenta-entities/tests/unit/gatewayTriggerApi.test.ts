/**
 * Unit tests for the gateway-trigger API layer.
 *
 * The triggers catalog isn't in the Fern client yet, so these functions call
 * the shared axios instance and validate the response against the frozen zod
 * schema at the boundary. Tests stub `@agenta/shared/api` (axios + URL) and the
 * project store so we can introspect the request shape and confirm boundary
 * validation without hitting the network.
 *
 * AC coverage:
 *  - Catalog browse: events are fetched against the WP1 API shape.
 *  - F2: `/triggers/connections/query` reads the same shared connection rows
 *    that `/tools/connections/query` returns, with no second connect.
 */

import {beforeEach, describe, expect, it, vi} from "vitest"

const {get, post} = vi.hoisted(() => ({get: vi.fn(), post: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {get, post},
    getAgentaApiUrl: () => "https://api.test",
}))

vi.mock("@agenta/shared/state", () => ({
    projectIdAtom: {__type: "projectIdAtom"},
}))

vi.mock("jotai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("jotai")>()
    return {...actual, getDefaultStore: () => ({get: () => "proj-42"})}
})

import {
    createTriggerSubscription,
    fetchTriggerSubscription,
    fetchTriggerEvent,
    fetchTriggerEvents,
    fetchTriggerProviders,
    queryTriggerConnections,
    queryTriggerDeliveries,
    queryTriggerSubscriptions,
} from "../../src/gatewayTrigger/api/api"

beforeEach(() => {
    get.mockReset()
    post.mockReset()
})

describe("catalog browse", () => {
    it("lists providers and scopes the request to the project", async () => {
        get.mockResolvedValueOnce({
            data: {count: 1, providers: [{key: "composio", name: "Composio"}]},
        })

        const res = await fetchTriggerProviders()

        const [url, opts] = get.mock.calls[0]
        expect(url).toBe("https://api.test/triggers/catalog/providers/")
        expect(opts.params).toMatchObject({project_id: "proj-42"})
        expect(res.providers[0].key).toBe("composio")
    })

    it("fetches an integration's events against the WP1 path with cursor params", async () => {
        get.mockResolvedValueOnce({
            data: {
                count: 1,
                total: 1,
                cursor: "next",
                events: [{key: "github_star", name: "Repo starred", categories: []}],
            },
        })

        const res = await fetchTriggerEvents("composio", "github", {
            query: "star",
            limit: 10,
            cursor: "c1",
        })

        const [url, opts] = get.mock.calls[0]
        expect(url).toBe(
            "https://api.test/triggers/catalog/providers/composio/integrations/github/events/",
        )
        expect(opts.params).toMatchObject({
            project_id: "proj-42",
            query: "star",
            limit: 10,
            cursor: "c1",
        })
        expect(res.events).toHaveLength(1)
        expect(res.cursor).toBe("next")
    })

    it("returns an event's trigger_config schema", async () => {
        const triggerConfig = {
            type: "object",
            properties: {owner: {type: "string"}, repo: {type: "string"}},
            required: ["owner", "repo"],
        }
        get.mockResolvedValueOnce({
            data: {
                count: 1,
                event: {
                    key: "github_star",
                    name: "Repo starred",
                    categories: [],
                    trigger_config: triggerConfig,
                },
            },
        })

        const res = await fetchTriggerEvent("composio", "github", "github_star")

        const [url] = get.mock.calls[0]
        expect(url).toBe(
            "https://api.test/triggers/catalog/providers/composio/integrations/github/events/github_star",
        )
        expect(res.event?.trigger_config).toEqual(triggerConfig)
    })

    it("falls back to an empty response when the payload fails validation", async () => {
        get.mockResolvedValueOnce({data: {events: "not-an-array"}})

        const res = await fetchTriggerEvents("composio", "github")

        expect(res).toEqual({count: 0, total: 0, cursor: null, events: []})
    })
})

describe("connections (F2 — shared rows)", () => {
    it("queries the same shared connection rows surfaced by /tools/connections", async () => {
        // A row created via /tools/connections; it appears verbatim under
        // /triggers/connections without a second connect.
        const sharedRow = {
            id: "conn-1",
            slug: "github-prod",
            name: "GitHub prod",
            provider_key: "composio",
            integration_key: "github",
            flags: {is_active: true, is_valid: true},
        }
        post.mockResolvedValueOnce({data: {count: 1, connections: [sharedRow]}})

        const res = await queryTriggerConnections({
            provider_key: "composio",
            integration_key: "github",
        })

        const [url, body, opts] = post.mock.calls[0]
        expect(url).toBe("https://api.test/triggers/connections/query")
        expect(body).toEqual({provider_key: "composio", integration_key: "github"})
        expect(opts.params).toMatchObject({project_id: "proj-42"})
        expect(res.connections[0]).toMatchObject({id: "conn-1", integration_key: "github"})
    })

    it("tolerates a connection with no flags (no crash, no second connect path)", async () => {
        post.mockResolvedValueOnce({
            data: {
                count: 1,
                connections: [{id: "conn-2", provider_key: "composio", integration_key: "slack"}],
            },
        })

        const res = await queryTriggerConnections()

        expect(res.connections).toHaveLength(1)
        expect(res.connections[0].integration_key).toBe("slack")
    })

    it("falls back to an empty list when the payload fails validation", async () => {
        post.mockResolvedValueOnce({data: {connections: 42}})

        const res = await queryTriggerConnections()

        expect(res).toEqual({count: 0, connections: []})
    })
})

describe("subscriptions", () => {
    const sampleSubscription = {
        id: "sub-1",
        name: "Star watch",
        connection_id: "conn-1",
        enabled: true,
        valid: true,
        data: {
            event_key: "github_star_added_event",
            ti_id: "ti_abc",
            trigger_config: {owner: "agenta", repo: "agenta"},
            inputs_fields: {message: "{{event.data.action}}"},
            references: {workflow_revision: {id: "rev-1"}},
        },
    }

    it("creates a subscription with the {subscription} envelope and project scope", async () => {
        post.mockResolvedValueOnce({data: {count: 1, subscription: sampleSubscription}})

        const res = await createTriggerSubscription({
            name: "Star watch",
            connection_id: "conn-1",
            data: {
                event_key: "github_star_added_event",
                inputs_fields: {message: "{{event.data.action}}"},
                references: {workflow_revision: {id: "rev-1"}},
            },
        })

        const [url, body, opts] = post.mock.calls[0]
        expect(url).toBe("https://api.test/triggers/subscriptions/")
        expect(body.subscription.connection_id).toBe("conn-1")
        expect(body.subscription.data.references.workflow_revision.id).toBe("rev-1")
        expect(opts.params).toMatchObject({project_id: "proj-42"})
        expect(res.subscription?.id).toBe("sub-1")
    })

    it("queries subscriptions and passes the filter under {subscription}", async () => {
        post.mockResolvedValueOnce({data: {count: 1, subscriptions: [sampleSubscription]}})

        const res = await queryTriggerSubscriptions({connection_id: "conn-1"})

        const [url, body] = post.mock.calls[0]
        expect(url).toBe("https://api.test/triggers/subscriptions/query")
        expect(body).toEqual({subscription: {connection_id: "conn-1"}})
        expect(res.subscriptions).toHaveLength(1)
        expect(res.subscriptions[0].data.event_key).toBe("github_star_added_event")
    })

    it("fetches a single subscription by id", async () => {
        get.mockResolvedValueOnce({data: {count: 1, subscription: sampleSubscription}})

        const res = await fetchTriggerSubscription("sub-1")

        const [url, opts] = get.mock.calls[0]
        expect(url).toBe("https://api.test/triggers/subscriptions/sub-1")
        expect(opts.params).toMatchObject({project_id: "proj-42"})
        expect(res.subscription?.connection_id).toBe("conn-1")
    })

    it("falls back to an empty list when the subscriptions payload fails validation", async () => {
        post.mockResolvedValueOnce({data: {subscriptions: "nope"}})

        const res = await queryTriggerSubscriptions()

        expect(res).toEqual({count: 0, subscriptions: []})
    })
})

describe("deliveries (read-only)", () => {
    it("queries deliveries for a subscription under the {delivery} envelope", async () => {
        post.mockResolvedValueOnce({
            data: {
                count: 1,
                deliveries: [
                    {
                        id: "del-1",
                        subscription_id: "sub-1",
                        event_id: "evt-123",
                        status: {type: "success", code: "200", timestamp: "2026-06-18T00:00:00Z"},
                        data: {event_key: "github_star_added_event", result: {ok: true}},
                    },
                ],
            },
        })

        const res = await queryTriggerDeliveries({subscription_id: "sub-1"})

        const [url, body, opts] = post.mock.calls[0]
        expect(url).toBe("https://api.test/triggers/deliveries/query")
        expect(body).toEqual({delivery: {subscription_id: "sub-1"}})
        expect(opts.params).toMatchObject({project_id: "proj-42"})
        expect(res.deliveries[0].event_id).toBe("evt-123")
        expect(res.deliveries[0].status.type).toBe("success")
    })

    it("falls back to an empty list when the deliveries payload fails validation", async () => {
        post.mockResolvedValueOnce({data: {deliveries: 7}})

        const res = await queryTriggerDeliveries()

        expect(res).toEqual({count: 0, deliveries: []})
    })
})
