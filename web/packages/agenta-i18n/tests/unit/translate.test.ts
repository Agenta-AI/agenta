import {describe, expect, it, vi} from "vitest"

import {sha256} from "../../scripts/catalog"
import {
    anthropicTranslator,
    mergeMeta,
    namespaceMeta,
    planNamespace,
    translateNamespace,
} from "../../scripts/translate"
import type {Item, TranslateBatch} from "../../scripts/translate"

const usage = {inputTokens: 10, outputTokens: 5}

function stub(answers: Record<string, string>): TranslateBatch & {calls: Item[][]} {
    const calls: Item[][] = []
    const fn = async (items: Item[]) => {
        calls.push(items)
        return {translations: answers, usage}
    }
    return Object.assign(fn, {calls})
}

describe("planNamespace", () => {
    it("sends missing and changed keys, adopts unhashed ones, removes stale ones", () => {
        const source = {same: "Same", changed: "New text", fresh: "Fresh", adopted: "Adopted"}
        const target = {same: "相同", changed: "旧文本", adopted: "采用", gone: "删除"}
        const meta = {same: sha256("Same"), changed: sha256("Old text"), gone: sha256("Gone")}
        expect(planNamespace(source, target, meta)).toEqual({
            send: [
                {key: "changed", en: "New text"},
                {key: "fresh", en: "Fresh"},
            ],
            adopt: ["adopted"],
            remove: ["gone"],
        })
    })

    it("plans only the zh-CN plural form", () => {
        const plan = planNamespace({n_one: "One", n_other: "{{count}} items"}, {n_one: "一"}, {})
        expect(plan.send).toEqual([{key: "n_other", en: "{{count}} items"}])
        expect(plan.remove).toEqual(["n_one"])
    })
})

describe("translateNamespace", () => {
    it("writes valid answers with hashes and keeps English key order", async () => {
        const translate = stub({b: "乙 {{name}}", a: "甲"})
        const result = await translateNamespace({a: "A", b: "B {{name}}"}, {}, {}, translate)
        expect(Object.keys(result.catalog)).toEqual(["a", "b"])
        expect(result.catalog).toEqual({a: "甲", b: "乙 {{name}}"})
        expect(result.meta).toEqual({a: sha256("A"), b: sha256("B {{name}}")})
        expect(result.usage).toEqual(usage)
    })

    it("rejects answers with wrong placeholders and keeps the old value and hash", async () => {
        const translate = stub({a: "你好 {{nom}}", b: ""})
        const meta = {a: sha256("Old {{name}}")}
        const result = await translateNamespace(
            {a: "Hi {{name}}", b: "B"},
            {a: "旧 {{name}}"},
            meta,
            translate,
        )
        expect(result.rejected).toEqual(["a", "b"])
        expect(result.catalog).toEqual({a: "旧 {{name}}"})
        expect(result.meta).toEqual(meta)
    })

    it("adopts existing values without calling the model", async () => {
        const translate = stub({})
        const result = await translateNamespace({a: "A"}, {a: "甲"}, {}, translate)
        expect(translate.calls).toEqual([])
        expect(result.catalog).toEqual({a: "甲"})
        expect(result.meta).toEqual({a: sha256("A")})
    })

    it("removes keys and hashes English no longer has", async () => {
        const result = await translateNamespace(
            {a: "A"},
            {a: "甲", gone: "去"},
            {a: sha256("A"), gone: sha256("Gone")},
            stub({}),
        )
        expect(result.catalog).toEqual({a: "甲"})
        expect(result.meta).toEqual({a: sha256("A")})
    })

    it("sends keys in batches", async () => {
        const translate = stub({a: "甲", b: "乙", c: "丙"})
        await translateNamespace({a: "A", b: "B", c: "C"}, {}, {}, translate, 2)
        expect(translate.calls.map((batch) => batch.map((item) => item.key))).toEqual([
            ["a", "b"],
            ["c"],
        ])
    })
})

describe("meta helpers", () => {
    it("splits and merges one namespace", () => {
        const meta = {"a.x": "1", "b.y": "2", "a.z": "3"}
        expect(namespaceMeta(meta, "a")).toEqual({x: "1", z: "3"})
        expect(mergeMeta(meta, "a", {x: "9"})).toEqual({"a.x": "9", "b.y": "2"})
    })
})

describe("anthropicTranslator", () => {
    it("sends the Messages API request and parses the structured answer", async () => {
        const fetchFn = vi.fn(async () =>
            Response.json({
                stop_reason: "end_turn",
                content: [
                    {type: "text", text: JSON.stringify({translations: [{key: "a", zh: "甲"}]})},
                ],
                usage: {input_tokens: 100, output_tokens: 20},
            }),
        )
        const translate = anthropicTranslator({
            apiKey: "test",
            model: "m",
            system: "sys",
            fetchFn: fetchFn as unknown as typeof fetch,
        })
        const result = await translate([{key: "a", en: "A"}])
        expect(result).toEqual({
            translations: {a: "甲"},
            usage: {inputTokens: 100, outputTokens: 20},
        })
        const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe("https://api.anthropic.com/v1/messages")
        const body = JSON.parse(init.body as string)
        expect(body.model).toBe("m")
        expect(body.output_config.format.type).toBe("json_schema")
    })

    it("fails on an API error or a cut-off answer", async () => {
        const failing = anthropicTranslator({
            apiKey: "test",
            model: "m",
            system: "sys",
            fetchFn: (async () =>
                Response.json({error: {message: "bad"}}, {status: 400})) as typeof fetch,
        })
        await expect(failing([{key: "a", en: "A"}])).rejects.toThrow("Anthropic API 400: bad")
        const cut = anthropicTranslator({
            apiKey: "test",
            model: "m",
            system: "sys",
            fetchFn: (async () => Response.json({stop_reason: "max_tokens"})) as typeof fetch,
        })
        await expect(cut([{key: "a", en: "A"}])).rejects.toThrow("max_tokens")
    })
})
