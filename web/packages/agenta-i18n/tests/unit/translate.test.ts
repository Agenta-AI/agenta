import {getDefaultStore} from "jotai"
import {afterEach, beforeAll, describe, expect, it} from "vitest"

import {createT, defineCatalog} from "../../src/catalog"
import {formatDate, formatNumber, richText} from "../../src/index"
import {activeLanguageAtom, getActiveLanguage, type Language} from "../../src/language"
import {catalogVersionAtom, loadLanguage} from "../../src/registry"
import {translate} from "../../src/translate"

const membersCatalog = defineCatalog("settings.members", {
    en: async () => ({
        default: {
            title: "Members",
            invite: "Invite {{email}} to {{workspace}}",
            count_one: "{{count}} member",
            count_other: "{{count}} members",
            onlyEnglish: "Only in English",
        },
    }),
    "zh-CN": async () => ({
        default: {
            title: "成员",
            invite: "邀请 {{email}} 加入 {{workspace}}",
            count_other: "{{count}} 位成员",
        },
    }),
    "ja-JP": async () => ({
        default: {title: "メンバー", count_other: "{{count}} 人のメンバー"},
    }),
})
const commonCatalog = defineCatalog("common", {
    en: async () => ({default: {cancel: "Cancel"}}),
    "zh-CN": async () => ({default: {cancel: "取消"}}),
    "ja-JP": async () => ({default: {cancel: "キャンセル"}}),
})
const t = createT(membersCatalog, commonCatalog)

const activateLanguage = async (language: Language) => {
    await loadLanguage(language)
    getDefaultStore().set(activeLanguageAtom, language)
}

const key = (k: string) => k as Parameters<typeof t>[0]

beforeAll(async () => {
    await loadLanguage("en")
})

afterEach(async () => {
    await activateLanguage("en")
})

describe("t in English", () => {
    it("returns the English text", () => {
        expect(t(key("settings.members.title"))).toBe("Members")
    })

    it("fills {{placeholders}} and leaves unknown ones as written", () => {
        expect(t(key("settings.members.invite"), {email: "a@b.co", workspace: "Acme"})).toBe(
            "Invite a@b.co to Acme",
        )
        expect(t(key("settings.members.invite"), {email: "a@b.co"})).toBe(
            "Invite a@b.co to {{workspace}}",
        )
    })

    it("picks the plural form from count", () => {
        expect(t(key("settings.members.count"), {count: 1})).toBe("1 member")
        expect(t(key("settings.members.count"), {count: 0})).toBe("0 members")
        expect(t(key("settings.members.count"), {count: 5})).toBe("5 members")
    })

    it("returns the key when no catalog has it", () => {
        expect(t(key("settings.members.missing"))).toBe("settings.members.missing")
        expect(t(key("nope.members.title"))).toBe("nope.members.title")
    })
})

describe("t in Chinese", () => {
    it("shows nothing until the English loads, then English until the language loads", async () => {
        const fresh = defineCatalog("settings.fresh", {
            en: async () => ({default: {title: "Fresh"}}),
            "zh-CN": async () => ({default: {title: "新"}}),
            "ja-JP": async () => ({default: {title: "新しい"}}),
        })
        const tFresh = createT(fresh)
        expect(tFresh("settings.fresh.title")).toBe("")
        await loadLanguage("en")
        expect(tFresh("settings.fresh.title")).toBe("Fresh")
    })

    it("stays English until the catalog is loaded", () => {
        expect(translate("zh-CN", "settings.members.title", undefined, [membersCatalog])).toBe(
            "Members",
        )
    })

    it("uses the loaded catalog, then falls back to English", async () => {
        await activateLanguage("zh-CN")
        expect(getActiveLanguage()).toBe("zh-CN")
        expect(t(key("settings.members.title"))).toBe("成员")
        expect(t(key("settings.members.invite"), {email: "a@b.co", workspace: "Acme"})).toBe(
            "邀请 a@b.co 加入 Acme",
        )
        expect(t(key("settings.members.onlyEnglish"))).toBe("Only in English")
    })

    it("uses _other for every count", async () => {
        await activateLanguage("zh-CN")
        expect(t(key("settings.members.count"), {count: 1})).toBe("1 位成员")
        expect(t(key("settings.members.count"), {count: 3})).toBe("3 位成员")
    })

    it("formats with the browser locale in English and the active language otherwise", async () => {
        const date = new Date(Date.UTC(2026, 9, 12))
        const options = {dateStyle: "long", timeZone: "UTC"} as const
        expect(formatDate(date, options)).toBe(
            new Intl.DateTimeFormat(undefined, options).format(date),
        )
        expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat(undefined).format(1234.5))
        await activateLanguage("zh-CN")
        expect(formatDate(date, options)).toBe("2026年10月12日")
    })

    it("reads the active language from the store", () => {
        getDefaultStore().set(activeLanguageAtom, "zh-CN")
        expect(getActiveLanguage()).toBe("zh-CN")
        expect(t(key("settings.members.title"))).toBe("成员")
    })
})

describe("richText", () => {
    it("renders tagged parts with the given elements and keeps the rest as text", () => {
        const parts = richText("Read <link>the docs</link> or <b>ask</b>.", {
            link: (text) => `[${text}]`,
        })
        const children = parts.map((part) => (part as {props: {children: unknown}}).props.children)
        expect(children).toEqual(["Read ", "[the docs]", " or ", "<b>ask</b>", "."])
    })
})

describe("more catalogs and languages", () => {
    it("takes keys from every catalog it was given", async () => {
        expect(t(key("common.cancel"))).toBe("Cancel")
        await activateLanguage("zh-CN")
        expect(t(key("common.cancel"))).toBe("取消")
    })

    it("loads a catalog registered after the switch and bumps the version", async () => {
        await activateLanguage("ja-JP")
        const before = getDefaultStore().get(catalogVersionAtom)
        getDefaultStore().set(activeLanguageAtom, "ja-JP")
        const late = defineCatalog("settings.late", {
            en: async () => ({default: {hello: "Hello"}}),
            "zh-CN": async () => ({default: {hello: "你好"}}),
            "ja-JP": async () => ({default: {hello: "こんにちは"}}),
        })
        const tLate = createT(late)
        await loadLanguage("en")
        await loadLanguage("ja-JP")
        expect(getDefaultStore().get(catalogVersionAtom)).toBeGreaterThan(before)
        expect(tLate("settings.late.hello")).toBe("こんにちは")
    })

    it("uses the Japanese text and its one plural form", async () => {
        await activateLanguage("ja-JP")
        expect(t(key("settings.members.title"))).toBe("メンバー")
        expect(t(key("settings.members.count"), {count: 1})).toBe("1 人のメンバー")
    })
})

describe("a language still loading", () => {
    it("shows nothing, not English, while the chosen language is still loading", async () => {
        let finish: () => void = () => undefined
        const slow = defineCatalog("settings.slow", {
            en: async () => ({default: {title: "Slow"}}),
            "zh-CN": () =>
                new Promise((resolve) => {
                    finish = () => resolve({default: {title: "慢"}})
                }),
            "ja-JP": async () => ({default: {title: "遅い"}}),
        })
        const tSlow = createT(slow)
        await loadLanguage("en")
        getDefaultStore().set(activeLanguageAtom, "zh-CN")
        const loading = loadLanguage("zh-CN")
        expect(tSlow("settings.slow.title")).toBe("")
        finish()
        await loading
        expect(tSlow("settings.slow.title")).toBe("慢")
    })
})
