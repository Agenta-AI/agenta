import {describe, expect, it} from "vitest"

import {
    defaultProviderLabel,
    disclosureAccountNames,
    disclosurePersonalAccountNames,
} from "../../src/sharing/result"

const disclosure = (...integrations: string[]) => ({
    connections: integrations.map((integration, index) => ({
        provider: "composio",
        integration,
        connection: `c${index}`,
    })),
    turns_use_run_credentials: true,
    files_and_tool_results_shared: true,
    trace_readers_can_read: true,
})

describe("the disclosure's account names", () => {
    it("names the integration, never the gateway behind it", () => {
        expect(disclosureAccountNames(disclosure("gmail", "google_drive"))).toEqual([
            "Gmail",
            "Google drive",
        ])
        expect(
            defaultProviderLabel({provider: "composio", integration: "gmail", connection: "c"}),
        ).toBe("Gmail")
    })

    it("uses the host's catalog label, once per name", () => {
        const labels: Record<string, string> = {gmail: "Gmail", shopify: "Shopify"}
        expect(
            disclosureAccountNames(
                disclosure("gmail", "shopify", "gmail"),
                (connection) => labels[connection.integration] ?? "?",
            ),
        ).toEqual(["Gmail", "Shopify"])
    })

    it("keeps the items that use each person's own account apart", () => {
        const mixed = {
            ...disclosure("slack"),
            connections: [
                ...disclosure("slack").connections,
                {provider: "composio", integration: "gmail", account_source: "user" as const},
            ],
        }
        expect(disclosureAccountNames(mixed)).toEqual(["Slack"])
        expect(disclosurePersonalAccountNames(mixed)).toEqual(["Gmail"])
    })
})
