import {describe, expect, it} from "vitest"

import {consentPopupFeatures} from "../../src/shared/consentPopupFeatures"

describe("consentPopupFeatures", () => {
    it("opens at 1024 by 768, centered over the opener, on a large screen", () => {
        expect(
            consentPopupFeatures({
                screen: {availWidth: 2560, availHeight: 1440},
                screenX: 100,
                screenY: 50,
                outerWidth: 1600,
                outerHeight: 1000,
            }),
        ).toBe("width=1024,height=768,left=388,top=166,popup=yes")
    })

    it("shrinks to a screen smaller than 1024 by 768 and stays centered", () => {
        expect(
            consentPopupFeatures({
                screen: {availWidth: 800, availHeight: 600},
                screenX: 0,
                screenY: 0,
                outerWidth: 800,
                outerHeight: 600,
            }),
        ).toBe("width=800,height=600,left=0,top=0,popup=yes")
    })
})
