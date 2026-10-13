import {describe, expect, it} from "vitest"

import {
    readBrowserAccess,
    writeBrowserAccess,
} from "../../src/DrillInView/SchemaControls/agentTemplate/browserAccess"

describe("readBrowserAccess", () => {
    it("reads an absent or unknown value as all logins", () => {
        expect(readBrowserAccess(undefined)).toEqual({mode: "all"})
        expect(readBrowserAccess({mode: "all"})).toEqual({mode: "all"})
        expect(readBrowserAccess({mode: "weird"})).toEqual({mode: "all"})
    })

    it("reads off and selected", () => {
        expect(readBrowserAccess({mode: "off"})).toEqual({mode: "off"})
        expect(readBrowserAccess({mode: "selected", profiles: ["a", 3, "b"]})).toEqual({
            mode: "selected",
            profiles: ["a", "b"],
        })
        expect(readBrowserAccess({mode: "selected"})).toEqual({mode: "selected", profiles: []})
    })

    it("reads the legacy single profile as that login selected", () => {
        expect(readBrowserAccess({profile: "a"})).toEqual({mode: "selected", profiles: ["a"]})
    })
})

describe("writeBrowserAccess", () => {
    const config = {instructions: {agents_md: "x"}, browser: {profile: "a"}}

    it("drops the browser key for all logins", () => {
        expect(writeBrowserAccess(config, {mode: "all"})).toEqual({
            instructions: {agents_md: "x"},
        })
    })

    it("writes off and selected in the new shape", () => {
        expect(writeBrowserAccess(config, {mode: "off"})).toEqual({
            instructions: {agents_md: "x"},
            browser: {mode: "off"},
        })
        expect(writeBrowserAccess(config, {mode: "selected", profiles: ["b"]})).toEqual({
            instructions: {agents_md: "x"},
            browser: {mode: "selected", profiles: ["b"]},
        })
    })
})
