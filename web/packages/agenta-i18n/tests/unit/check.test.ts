import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

import {placeholders, targetKeys} from "../../scripts/catalog"
import {checkLocales, checkNamespace, parseNamespace} from "../../scripts/check"

describe("placeholders", () => {
    it("returns sorted unique names and ignores spaces", () => {
        expect(placeholders("{{b}} and {{ a }} and {{b}}")).toEqual(["a", "b"])
        expect(placeholders("no values")).toEqual([])
    })
})

describe("targetKeys", () => {
    it("maps an English plural family to the zh-CN _other form", () => {
        const keys = targetKeys(
            {title: "Members", count_one: "One member", count_other: "{{count}} members"},
            "zh-CN",
        )
        expect([...keys]).toEqual([
            ["title", "Members"],
            ["count_other", "{{count}} members"],
        ])
    })
})

describe("checkNamespace", () => {
    it("passes matching catalogs", () => {
        expect(
            checkNamespace(
                "settings",
                {title: "Hi {{name}}", n_one: "One", n_other: "{{count}} items"},
                {title: "你好 {{name}}", n_other: "{{count}} 项"},
            ),
        ).toEqual([])
    })

    it("lists missing and extra keys in both directions", () => {
        expect(checkNamespace("settings", {a: "A", b: "B"}, {a: "甲", c: "丙"})).toEqual([
            "settings: missing in zh-CN: b",
            "settings: not in en: c",
        ])
    })

    it("reports placeholder differences", () => {
        expect(checkNamespace("s", {a: "Hi {{name}}"}, {a: "你好 {{nme}}"})).toEqual([
            "s: placeholders differ in a: en has {{name}}, zh-CN has {{nme}}",
        ])
    })

    it("checks plural families per language", () => {
        expect(
            checkNamespace(
                "s",
                {n_other: "{{count}} items"},
                {n_one: "x", n_other: "{{count}} 项"},
            ),
        ).toEqual(["s: en misses plural form n_one", "s: zh-CN has unused plural form n_one"])
        expect(checkNamespace("s", {n_one: "One", n_other: "{{count}}"}, {n: "{{count}}"})).toEqual(
            ["s: plural in only one language: n"],
        )
    })

    it("rejects values that are not strings", () => {
        expect(checkNamespace("s", {a: "A"}, {a: 1})).toContain("s: zh-CN value is not a string: a")
    })
})

describe("checkLocales", () => {
    function locales(files: Record<string, Record<string, unknown>>): string {
        const dir = mkdtempSync(join(tmpdir(), "i18n-check-"))
        for (const [path, content] of Object.entries(files)) {
            mkdirSync(join(dir, path, ".."), {recursive: true})
            writeFileSync(join(dir, path), JSON.stringify(content))
        }
        return dir
    }

    it("checks every namespace, or only the one asked for", () => {
        const dir = locales({
            "en/a.json": {x: "X"},
            "zh-CN/a.json": {x: "叉"},
            "en/b.json": {y: "Y"},
            "zh-CN/c.json": {z: "Z"},
        })
        expect(checkLocales(dir)).toEqual(["b: missing in zh-CN: y", "c: not in en: z"])
        expect(checkLocales(dir, "a")).toEqual([])
        expect(checkLocales(dir, "nope")).toEqual(["nope: no catalog in either language"])
    })
})

describe("parseNamespace", () => {
    it("reads the flag value", () => {
        expect(parseNamespace(["--namespace", "settings"])).toBe("settings")
        expect(parseNamespace([])).toBeUndefined()
        expect(() => parseNamespace(["--namespace"])).toThrow()
    })
})
