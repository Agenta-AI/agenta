import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

import {flagValue, placeholders, targetKeys, targetLanguages} from "../../scripts/catalog"
import {checkLocales, checkNamespace, namespaceProblems} from "../../scripts/check"

function locales(files: Record<string, Record<string, unknown>>): string {
    const dir = mkdtempSync(join(tmpdir(), "i18n-check-"))
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(dir, path, ".."), {recursive: true})
        writeFileSync(join(dir, path), JSON.stringify(content))
    }
    return dir
}

describe("placeholders", () => {
    it("returns sorted unique names and ignores spaces", () => {
        expect(placeholders("{{b}} and {{ a }} and {{b}}")).toEqual(["{{a}}", "{{b}}"])
        expect(placeholders("no values")).toEqual([])
    })

    it("collects every rich-text tag", () => {
        expect(placeholders("<link>Contact us</link> on <date>{{day}}</date>")).toEqual([
            "</date>",
            "</link>",
            "<date>",
            "<link>",
            "{{day}}",
        ])
        expect(placeholders("a < b and <br />")).toEqual(["<br/>"])
    })
})

describe("targetKeys", () => {
    it("maps an English plural family to the _other form for zh-CN and ja-JP", () => {
        const source = {title: "Members", count_one: "One member", count_other: "{{count}} members"}
        for (const lang of ["zh-CN", "ja-JP"]) {
            expect([...targetKeys(source, lang)]).toEqual([
                ["title", "Members"],
                ["count_other", "{{count}} members"],
            ])
        }
    })
})

describe("checkNamespace", () => {
    it("passes matching catalogs", () => {
        expect(
            checkNamespace(
                {title: "Hi {{name}}", n_one: "One", n_other: "{{count}} items"},
                {title: "你好 {{name}}", n_other: "{{count}} 项"},
                "zh-CN",
            ),
        ).toEqual([])
    })

    it("lists missing and extra keys", () => {
        expect(checkNamespace({a: "A", b: "B"}, {a: "甲", c: "丙"}, "zh-CN")).toEqual([
            "missing in zh-CN: b",
            "zh-CN has a key English does not need: c",
        ])
    })

    it("reports placeholder differences", () => {
        expect(checkNamespace({a: "Hi {{name}}"}, {a: "你好 {{nme}}"}, "zh-CN")).toEqual([
            "placeholders or tags differ in a: en has {{name}}, zh-CN has {{nme}}",
        ])
    })

    it("reports a dropped or renamed rich-text tag", () => {
        expect(checkNamespace({a: "<link>Contact us</link>"}, {a: "联系我们"}, "zh-CN")).toEqual([
            "placeholders or tags differ in a: en has </link> <link>, zh-CN has none",
        ])
        expect(
            checkNamespace({a: "Run <code>x</code>"}, {a: "<cmd>x</cmd> を実行"}, "ja-JP"),
        ).toHaveLength(1)
        expect(
            checkNamespace({a: "<link>Contact</link>"}, {a: "<link>联系</link>"}, "zh-CN"),
        ).toEqual([])
    })

    it("compares a plural form with the English _other text only", () => {
        // English _one may drop or add values; the translation follows _other.
        expect(
            checkNamespace(
                {n_one: "{{name}} has one item", n_other: "{{count}} items"},
                {n_other: "{{count}} 项"},
                "zh-CN",
            ),
        ).toEqual([])
    })

    it("checks English plural families and unused target forms", () => {
        expect(
            checkNamespace(
                {n_other: "{{count}} items"},
                {n_one: "x", n_other: "{{count}} 项"},
                "zh-CN",
            ),
        ).toEqual(["en misses plural form n_one", "zh-CN has a key English does not need: n_one"])
    })

    it("rejects values that are not strings", () => {
        expect(checkNamespace({a: "A"}, {a: 1}, "ja-JP")).toEqual([
            "ja-JP value is not a string: a",
        ])
    })
})

describe("checkLocales", () => {
    it("checks every language and namespace, or only the ones asked for", () => {
        const dir = locales({
            "en/a.json": {x: "X"},
            "zh-CN/a.json": {x: "叉"},
            "ja-JP/a.json": {},
            "en/b.json": {y: "Y"},
            "zh-CN/b.json": {y: "乙"},
            "ja-JP/b.json": {y: "ワイ"},
            ".meta/zh-CN.json": {},
        })
        expect(targetLanguages(dir)).toEqual(["ja-JP", "zh-CN"])
        expect(checkLocales(dir, targetLanguages(dir))).toEqual(["ja-JP/a: missing in ja-JP: x"])
        expect(checkLocales(dir, ["zh-CN"], "a")).toEqual([])
        expect(checkLocales(dir, ["zh-CN"], "nope")).toEqual([
            "zh-CN/nope: no catalog in either language",
        ])
    })
})

describe("namespaceProblems", () => {
    it("rejects a namespace that starts with another namespace and a dot", () => {
        expect(namespaceProblems(["billing", "billing.page", "billingx", "common"])).toEqual([
            "namespace billing.page starts with namespace billing; rename one of them",
        ])
        expect(namespaceProblems(["billing.page", "billing.topups"])).toEqual([])
    })
})

describe("flagValue", () => {
    it("reads the flag value", () => {
        expect(flagValue(["--namespace", "settings"], "--namespace")).toBe("settings")
        expect(flagValue([], "--lang")).toBeUndefined()
        expect(() => flagValue(["--lang"], "--lang")).toThrow()
    })
})
