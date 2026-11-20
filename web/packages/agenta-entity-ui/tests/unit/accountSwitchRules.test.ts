/** The rules of an integration's account part (F10): switch, "Use my default", shared list, warning. */
import {describe, expect, it} from "vitest"

import {
    accountSourcePick,
    defaultAccountOf,
    hasAutomationWithoutPerson,
    sharedAccountOptions,
    showAccountSwitch,
    USE_MY_DEFAULT,
    yourAccountValue,
} from "../../src/DrillInView/SchemaControls/agentTemplate/accounts/integrationAccountSwitch"

const own = (id: string, extra: Record<string, unknown> = {}) =>
    ({
        id,
        slug: id,
        name: id,
        integration_key: "zendesk",
        provider_key: "composio",
        ...extra,
    }) as never

describe("the account switch", () => {
    it("shows while personal accounts are on", () => {
        expect(showAccountSwitch("on", {accountSource: "agent"})).toBe(true)
    })
    it("hides while personal accounts are off or unreadable", () => {
        expect(showAccountSwitch("off", {accountSource: "agent"})).toBe(false)
        expect(showAccountSwitch("error", {accountSource: "agent"})).toBe(false)
    })
    it("still shows a saved each-person value while personal accounts are off", () => {
        expect(showAccountSwitch("off", {accountSource: "user"})).toBe(true)
    })
})

describe("Your account", () => {
    it("reads Use my default when the viewer has no choice for this agent", () => {
        expect(yourAccountValue(undefined)).toBe(USE_MY_DEFAULT)
        expect(
            yourAccountValue({
                item_key: "k",
                match: "default",
                gateway_connection_id: "a",
                is_ready: true,
            }),
        ).toBe(USE_MY_DEFAULT)
    })
    it("reads the chosen account when the viewer picked one", () => {
        expect(
            yourAccountValue({
                item_key: "k",
                match: "choice",
                gateway_connection_id: "b",
                is_ready: true,
            }),
        ).toBe("b")
    })
    it("Use my default follows the default account, also after it changes", () => {
        const before = [own("lena", {is_default: true}), own("sandbox")]
        expect(defaultAccountOf(before, undefined)?.id).toBe("lena")
        const after = [own("lena"), own("sandbox", {is_default: true})]
        expect(defaultAccountOf(after, undefined)?.id).toBe("sandbox")
    })
})

describe("Shared account", () => {
    it("lists each project connection once and keeps a saved slug that is gone", () => {
        const options = sharedAccountOptions(
            [
                {slug: "acme-support", name: "acme-support"},
                {slug: "acme-support", name: "dup"},
                {slug: "acme-eu-support", name: ""},
            ],
            {accountSource: "agent", connection: "old-slug"},
        )
        expect(options.map((o) => o.slug)).toEqual(["acme-support", "acme-eu-support", "old-slug"])
        expect(options[1].name).toBe("acme-eu-support")
    })
})

describe("runs without a person", () => {
    const agent = "agent-1"
    it("warns for an automation of this agent saved with an API key", () => {
        expect(
            hasAutomationWithoutPerson([{artifact_id: agent, principal: {kind: "api_key"}}], agent),
        ).toBe(true)
    })
    it("does not warn for an automation saved in the app by a person", () => {
        expect(
            hasAutomationWithoutPerson([{artifact_id: agent, principal: {kind: "human"}}], agent),
        ).toBe(false)
    })
    it("ignores automations of other agents and ones with no principal", () => {
        expect(
            hasAutomationWithoutPerson(
                [{artifact_id: "other", principal: {kind: "api_key"}}, {artifact_id: agent}],
                agent,
            ),
        ).toBe(false)
    })
})

describe("a pick on the switch", () => {
    it("each person's own drops the slug", () => {
        expect(accountSourcePick("user", {connection: "acme"}, [])).toEqual({
            write: {accountSource: "user"},
        })
    })
    it("one shared account keeps the saved slug, else takes the project's first connection", () => {
        expect(accountSourcePick("agent", {connection: "acme"}, [{slug: "eu"}])).toEqual({
            write: {accountSource: "agent", slug: "acme"},
        })
        expect(accountSourcePick("agent", {connection: ""}, [{slug: "eu"}])).toEqual({
            write: {accountSource: "agent", slug: "eu"},
        })
    })
    it("one shared account with no connection connects one first and writes nothing", () => {
        expect(accountSourcePick("agent", {connection: ""}, [])).toEqual({connect: "project"})
    })
})
