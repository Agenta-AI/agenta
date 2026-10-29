import {describe, expect, it} from "vitest"

import {normalizeBuildKitState, resolveBuildKitPermissions} from "../../src/workflow/buildKitPolicy"

const overlay = {
    tools: [
        {type: "platform", op: "read"},
        {type: "platform", op: "write"},
        {type: "platform", op: "unknown"},
        {"@ag.embed": {}},
    ],
    op_access: {read: "read", write: "write"},
}

describe("build kit permissions", () => {
    it("allows all without a saved policy", () => {
        expect(resolveBuildKitPermissions(overlay, {enabled: true, disabledOps: []})).toEqual({
            read: "allow",
            write: "allow",
            unknown: "allow",
        })
    })
    it("resolves Allow reads conservatively for missing metadata", () => {
        expect(
            resolveBuildKitPermissions(overlay, {
                enabled: true,
                disabledOps: [],
                permissionDefault: "allow_reads",
            }),
        ).toEqual({read: "allow", write: "ask", unknown: "ask"})
    })
    it("asks for every tool", () => {
        expect(
            resolveBuildKitPermissions(overlay, {
                enabled: true,
                disabledOps: [],
                permissionDefault: "ask",
            }),
        ).toEqual({read: "ask", write: "ask", unknown: "ask"})
    })
    it("applies overrides, removes deactivated tools and ignores stale ops", () => {
        expect(
            resolveBuildKitPermissions(overlay, {
                enabled: true,
                disabledOps: ["unknown"],
                permissionDefault: "ask",
                permissionOverrides: {read: "allow", stale: "allow"},
            }),
        ).toEqual({read: "allow", write: "ask"})
    })
    it("normalizes legacy and malformed values", () => {
        expect(
            normalizeBuildKitState({
                enabled: false,
                disabledOps: ["write", 123],
                permissionDefault: "bad",
                permissionOverrides: {read: "allow", write: "deny"},
            }),
        ).toEqual({enabled: false, disabledOps: ["write"], permissionOverrides: {read: "allow"}})
    })
})

import fixtures from "../fixtures/buildKitPermissions.json"

it.each(fixtures)("resolves the cross-language fixture $state", ({state, expected}) => {
    const kit = {
        tools: [
            {type: "platform", op: "read_config"},
            {type: "platform", op: "create_schedule"},
        ],
        op_access: {read_config: "read", create_schedule: "write"},
    }
    expect(resolveBuildKitPermissions(kit, normalizeBuildKitState(state))).toEqual(expected)
})
