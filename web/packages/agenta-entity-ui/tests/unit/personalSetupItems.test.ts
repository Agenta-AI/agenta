/**
 * The chat card lists only the viewer's own missing items: requirements with
 * account_source "user", never an agent item and never a run-blocking model login.
 */
import type {AgentRequirementItem} from "@agenta/entities/workflow"
import {describe, expect, it} from "vitest"

import {personalSetupItems} from "../../src/onboarding/personalSetup"

const req = (over: Partial<AgentRequirementItem>): AgentRequirementItem => ({
    key: "k",
    kind: "app_connection",
    label: "x",
    reference: {},
    paths: [],
    reason: "needs_personal_account",
    blocks_run: false,
    ...over,
})

describe("personalSetupItems", () => {
    it("keeps the user items and names each by what it is", () => {
        const items = personalSetupItems([
            req({
                key: "app_connection:user/gmail",
                account_source: "user",
                label: "gmail",
                reference: {provider: "composio", integration: "gmail"},
                fix: {candidates: 2},
            }),
            req({
                key: "mcp_sign_in:user/linear",
                kind: "mcp_sign_in",
                account_source: "user",
                label: "linear",
                reference: {type: "gateway", namespace: "custom", slug: "linear"},
                reason: "needs_sign_in",
            }),
            req({
                key: "secret:user/GITHUB_TOKEN",
                kind: "secret",
                account_source: "user",
                label: "GITHUB_TOKEN",
            }),
        ])
        expect(items).toEqual([
            {key: "app_connection:user/gmail", kind: "app_connection", name: "gmail", candidates: 2},
            {key: "mcp_sign_in:user/linear", kind: "mcp", name: "linear", candidates: 0},
            {key: "secret:user/GITHUB_TOKEN", kind: "secret", name: "GITHUB_TOKEN", candidates: 0},
        ])
    })

    it("leaves out agent items, whatever their kind", () => {
        expect(
            personalSetupItems([
                req({key: "app_connection:hubspot", reference: {integration: "hubspot"}}),
                req({key: "mcp_server:notion", kind: "mcp_server", account_source: "agent"}),
            ]),
        ).toEqual([])
    })

    it("leaves out a user model login, which blocks the run and has its own strip", () => {
        expect(
            personalSetupItems([
                req({
                    key: "subscription:user/claude",
                    kind: "subscription",
                    account_source: "user",
                    blocks_run: true,
                }),
            ]),
        ).toEqual([])
    })

    it("is empty before Needs setup answered", () => {
        expect(personalSetupItems(null)).toEqual([])
    })
})
