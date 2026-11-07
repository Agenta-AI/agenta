// @vitest-environment jsdom
import {createElement} from "react"
import {act} from "react"

import {getDefaultStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {expect, it} from "vitest"

import {defineCatalog} from "../../src/catalog"
import {activeLanguageAtom, languageAtom, useLanguageSync} from "../../src/language"

it("keeps the newest choice when an older language finishes loading later", async () => {
    let finishChinese: () => void = () => undefined
    defineCatalog(
        "settings.race",
        {title: "Race"},
        {
            "zh-CN": () =>
                new Promise((resolve) => {
                    finishChinese = () => resolve({default: {title: "赛跑"}})
                }),
            "ja-JP": async () => ({default: {title: "レース"}}),
        },
    )
    const store = getDefaultStore()
    const Sync = () => {
        useLanguageSync()
        return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => root.render(createElement(Provider, {store}, createElement(Sync))))

    await act(async () => store.set(languageAtom, "zh-CN"))
    await act(async () => store.set(languageAtom, "ja-JP"))
    expect(store.get(activeLanguageAtom)).toBe("ja-JP")

    await act(async () => finishChinese())
    expect(store.get(activeLanguageAtom)).toBe("ja-JP")
    root.unmount()
})
