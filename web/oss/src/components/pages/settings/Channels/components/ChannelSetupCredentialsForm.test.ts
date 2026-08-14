import type {AgentaApi} from "@agentaai/api-client"
import {describe, expect, it} from "vitest"

import {describeSetupFormFields, splitSetupFieldValues} from "./ChannelSetupCredentialsForm"

// Deliberately not Slack's field names: a test that only proves the form
// handles bot_token/signing_secret/api_app_id proves nothing about whether
// the component is driven by the declaration or hardcoded to it.
const fixtureFields: AgentaApi.ChannelSetupField[] = [
    {name: "api_token", label: "API token", secret: true, required: true},
    {name: "hmac_secret", label: "HMAC secret", secret: true, required: true},
    {name: "workspace_id", label: "Workspace ID", secret: false, required: true},
]

describe("describeSetupFormFields", () => {
    it("maps every declared field, deriving password-ness from `secret` alone", () => {
        const specs = describeSetupFormFields(fixtureFields)

        expect(specs).toHaveLength(3)
        expect(specs.filter((spec) => spec.isPassword)).toHaveLength(2)
        expect(specs.every((spec) => spec.required)).toBe(true)
        expect(specs.map((spec) => spec.name)).toEqual(["api_token", "hmac_secret", "workspace_id"])
    })

    it("defaults required to true when the declaration omits it", () => {
        const specs = describeSetupFormFields([{name: "x", label: "X", secret: false}])

        expect(specs[0].required).toBe(true)
    })

    it("respects an explicit required: false", () => {
        const specs = describeSetupFormFields([
            {name: "x", label: "X", secret: false, required: false},
        ])

        expect(specs[0].required).toBe(false)
    })

    it("returns an empty list for an undefined declaration", () => {
        expect(describeSetupFormFields(undefined)).toEqual([])
    })
})

describe("splitSetupFieldValues", () => {
    it("routes secret fields to credentials and everything else to data", () => {
        const {data, credentials} = splitSetupFieldValues(fixtureFields, {
            api_token: "tok",
            hmac_secret: "sec",
            workspace_id: "W1",
        })

        expect(credentials).toEqual({api_token: "tok", hmac_secret: "sec"})
        expect(data).toEqual({workspace_id: "W1"})
    })

    it("never lets a non-secret field reach credentials -- the api_app_id failure mode", () => {
        // Slack's own shape: api_app_id is a locator, not a secret. Routing it
        // to credentials makes it vanish silently (the secret DTO ignores
        // unknown keys) -- this is the one behavior that must never regress.
        const fields: AgentaApi.ChannelSetupField[] = [
            {name: "bot_token", label: "Bot token", secret: true, required: true},
            {name: "signing_secret", label: "Signing secret", secret: true, required: true},
            {name: "api_app_id", label: "App ID", secret: false, required: true},
        ]

        const {data, credentials} = splitSetupFieldValues(fields, {
            bot_token: "xoxb-x",
            signing_secret: "sec",
            api_app_id: "A123",
        })

        expect(credentials).not.toHaveProperty("api_app_id")
        expect(data.api_app_id).toBe("A123")
    })

    it("omits empty or undefined values from both buckets", () => {
        const {data, credentials} = splitSetupFieldValues(fixtureFields, {
            api_token: "",
            hmac_secret: undefined,
            workspace_id: "W1",
        })

        expect(credentials).toEqual({})
        expect(data).toEqual({workspace_id: "W1"})
    })

    it("returns empty buckets for an undefined declaration", () => {
        expect(splitSetupFieldValues(undefined, {anything: "x"})).toEqual({
            data: {},
            credentials: {},
        })
    })
})
