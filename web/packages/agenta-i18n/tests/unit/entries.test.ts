import {describe, expect, it} from "vitest"

import {t} from "../../src/settings"

describe("the settings entry", () => {
    it("carries the billing, channels, publish and common catalogs", () => {
        expect(t("billing.autoRenewsOn", {date: "May 1"})).toBe("Auto renews on <date>May 1</date>")
        expect(t("channels.actions.addSpaceFailed")).toBe("Could not add this channel.")
        expect(t("publish.aboutSection", {title: "Embed"})).toBe("About Embed")
        expect(t("common.actions")).toBe("Actions")
    })
})
