import {CustomSecretFormat} from "@agenta/entities/secret"
import {describe, expect, it} from "vitest"

import {buildSecretContent} from "./content"

const hiddenJsonInput = {
    format: CustomSecretFormat.Json,
    originalFormat: CustomSecretFormat.Json,
    valueHidden: true,
    textValue: "",
    jsonView: "json" as const,
    jsonText: "{}",
    kvRows: [{key: "", value: ""}],
}

describe("buildSecretContent", () => {
    it("preserves untouched hidden JSON after switching to Editor", () => {
        expect(buildSecretContent({...hiddenJsonInput, replacementSupplied: false})).toEqual({
            content: undefined,
        })
    })

    it("returns the parsed dirty Editor value instead of stale grid state", () => {
        expect(
            buildSecretContent({
                ...hiddenJsonInput,
                replacementSupplied: true,
                jsonText: '{"token":"new-value","enabled":true}',
            }),
        ).toEqual({content: {token: "new-value", enabled: true}})
    })

    it("rejects a hidden format change without replacement content", () => {
        expect(
            buildSecretContent({
                ...hiddenJsonInput,
                format: CustomSecretFormat.Text,
                replacementSupplied: false,
            }),
        ).toEqual({error: "Enter replacement content before changing the secret format."})
    })
})
