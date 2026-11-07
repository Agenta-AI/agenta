import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("../../locales/zh-CN/billing.json", () => ({default: {}}))
vi.mock("../../locales/zh-CN/channels.json", () => ({default: {}}))
vi.mock("../../locales/zh-CN/publish.json", () => ({default: {}}))
vi.mock("../../locales/zh-CN/common.json", () => ({default: {}}))
vi.mock("../../locales/zh-CN/navigation.json", () => ({default: {}}))
vi.mock("../../locales/zh-CN/settings.json", () => ({
    default: {
        "members.title": "成员",
        "members.invite": "邀请 {{email}} 加入 {{workspace}}",
        "members.count_other": "{{count}} 位成员",
    },
}))

import {formatNumber, richText} from "../../src/index"
import {activateLanguage, getActiveLanguage} from "../../src/language"
import {defineNamespace} from "../../src/namespace"
import {translate} from "../../src/translate"

const {t} = defineNamespace("settings", {
    "members.title": "Members",
    "members.invite": "Invite {{email}} to {{workspace}}",
    "members.count_one": "{{count}} member",
    "members.count_other": "{{count}} members",
    "members.onlyEnglish": "Only in English",
})

// Keys in these tests come from the test catalog above, not the typed English files.
const key = (k: string) => k as Parameters<typeof t>[0]

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
    it("stays English until the catalog is loaded", () => {
        expect(translate("zh-CN", key("settings.members.title"))).toBe("Members")
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

    it("formats numbers for the active language", async () => {
        expect(formatNumber(1234.5)).toBe("1,234.5")
        await activateLanguage("zh-CN")
        expect(formatNumber(0.5, {style: "percent"})).toBe("50%")
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
