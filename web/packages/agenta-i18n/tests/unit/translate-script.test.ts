import {describe, expect, it, vi} from "vitest"

import {sha256} from "../../scripts/catalog"
import {
    anthropicTranslator,
    planNamespace,
    systemPrompt,
    TranslateError,
    translateNamespace,
} from "../../scripts/translate"
import type {Catalog} from "../../scripts/catalog"
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

function run(
    source: Catalog,
    target: Catalog,
    meta: Catalog,
    translate: TranslateBatch,
    size?: number,
) {
    const plan = planNamespace(source, target, meta, "zh-CN")
    return translateNamespace(plan, target, meta, translate, size)
}

describe("planNamespace", () => {
    it("sends missing and changed keys, adopts unhashed ones, removes stale ones", () => {
        const source = {same: "Same", changed: "New text", fresh: "Fresh", adopted: "Adopted"}
        const target = {same: "相同", changed: "旧文本", adopted: "采用", gone: "删除"}
        const meta = {same: sha256("Same"), changed: sha256("Old text"), gone: sha256("Gone")}
        const {wanted, ...plan} = planNamespace(source, target, meta, "zh-CN")
        expect([...wanted.keys()]).toEqual(Object.keys(source))
        expect(plan).toEqual({
            send: [
                {key: "changed", en: "New text"},
                {key: "fresh", en: "Fresh"},
            ],
            adopt: ["adopted"],
            remove: ["gone"],
        })
    })

    it("plans only the _other plural form", () => {
        const plan = planNamespace(
            {n_one: "One", n_other: "{{count}} items"},
            {n_one: "一"},
            {},
            "ja-JP",
        )
        expect(plan.send).toEqual([{key: "n_other", en: "{{count}} items"}])
        expect(plan.remove).toEqual(["n_one"])
    })
})

describe("translateNamespace", () => {
    it("writes valid answers with hashes and keeps English key order", async () => {
        const translate = stub({b: "乙 {{name}}", a: "甲"})
        const result = await run({a: "A", b: "B {{name}}"}, {}, {}, translate)
        expect(Object.keys(result.catalog)).toEqual(["a", "b"])
        expect(result.catalog).toEqual({a: "甲", b: "乙 {{name}}"})
        expect(result.meta).toEqual({a: sha256("A"), b: sha256("B {{name}}")})
        expect(result.usage).toEqual(usage)
    })

    it("rejects answers with wrong placeholders and keeps the old value and hash", async () => {
        const translate = stub({a: "你好 {{nom}}", b: ""})
        const meta = {a: sha256("Old {{name}}")}
        const result = await run({a: "Hi {{name}}", b: "B"}, {a: "旧 {{name}}"}, meta, translate)
        expect(result.rejected).toEqual(["a", "b"])
        expect(result.catalog).toEqual({a: "旧 {{name}}"})
        expect(result.meta).toEqual(meta)
    })

    it("adopts existing values without calling the model", async () => {
        const translate = stub({})
        const result = await run({a: "A"}, {a: "甲"}, {}, translate)
        expect(translate.calls).toEqual([])
        expect(result.catalog).toEqual({a: "甲"})
        expect(result.meta).toEqual({a: sha256("A")})
    })

    it("removes keys and hashes English no longer has", async () => {
        const result = await run(
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
        await run({a: "A", b: "B", c: "C"}, {}, {}, translate, 2)
        expect(translate.calls.map((batch) => batch.map((item) => item.key))).toEqual([
            ["a", "b"],
            ["c"],
        ])
    })
})

describe("systemPrompt", () => {
    it("adds the language style and the glossary, and refuses an unknown language", () => {
        const prompt = systemPrompt("ja-JP", {Agent: "エージェント"})
        expect(prompt).toContain("Japanese (ja-JP)")
        expect(prompt).toContain("Agent => エージェント")
        expect(() => systemPrompt("xx", {})).toThrow(TranslateError)
    })
})

describe("anthropicTranslator", () => {
    it("sends the Messages API request and parses the structured answer", async () => {
        const fetchFn = vi.fn(async () =>
            Response.json({
                stop_reason: "end_turn",
                content: [
                    {type: "text", text: JSON.stringify({translations: [{key: "a", text: "甲"}]})},
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
        expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01")
        const body = JSON.parse(init.body as string)
        expect(body.model).toBe("m")
        expect(body.output_config.format.type).toBe("json_schema")
    })

    it("fails with the status only, never the response text", async () => {
        const translator = (response: Response) =>
            anthropicTranslator({
                apiKey: "secret-key",
                model: "m",
                system: "sys",
                fetchFn: (async () => response) as typeof fetch,
            })
        const failing = translator(
            new Response("<html>bad gateway secret-key</html>", {status: 502}),
        )
        const error = await failing([{key: "a", en: "A"}]).catch((e: Error) => e)
        expect(error).toBeInstanceOf(TranslateError)
        expect((error as Error).message).toBe("Anthropic API returned HTTP 502")
        await expect(
            translator(Response.json({stop_reason: "max_tokens"}))([{key: "a", en: "A"}]),
        ).rejects.toThrow("did not finish")
        await expect(
            translator(Response.json({stop_reason: "end_turn", content: []}))([
                {key: "a", en: "A"},
            ]),
        ).rejects.toThrow("no text")
    })
})
