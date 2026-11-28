import {describe, expect, it} from "vitest"

import {detectValueShape, formatShapeNumber, readValueMessage} from "../../src/utils/valueShape"

const lines = (count: number) =>
    Array.from({length: count}, (_, index) => `line ${index + 1}`).join("\n")

describe("detectValueShape", () => {
    it("names every empty value empty", () => {
        for (const value of [undefined, null, "", [], {}]) {
            expect(detectValueShape(value).shape).toBe("empty")
        }
    })

    it("names booleans and numbers", () => {
        expect(detectValueShape(false)).toEqual({shape: "boolean", value: false})
        expect(detectValueShape(0)).toEqual({shape: "number", value: 0})
        expect(detectValueShape(0.875).shape).toBe("number")
    })

    it("names a whole-string URL before any text shape", () => {
        expect(detectValueShape("https://help.example.com/returns/defects").shape).toBe("url")
        expect(detectValueShape("blob:https://example.com/1").shape).toBe("url")
        expect(detectValueShape("see https://example.com").shape).toBe("text-short")
    })

    it("splits short text, long text and markdown", () => {
        expect(detectValueShape("Amanda decided: not_seen").shape).toBe("text-short")
        expect(detectValueShape(lines(12)).shape).toBe("text-short")
        expect(detectValueShape(lines(13)).shape).toBe("text-long")
        expect(detectValueShape("a".repeat(1500)).shape).toBe("text-short")
        expect(detectValueShape("a".repeat(1501)).shape).toBe("text-long")
        expect(detectValueShape("## Summary\n\n- one\n- two").shape).toBe("markdown")
        expect(detectValueShape("Pay **now**").shape).toBe("markdown")
        expect(detectValueShape("Read [the docs](https://example.com)").shape).toBe("markdown")
    })

    it("names long markdown markdown, not long text", () => {
        expect(detectValueShape(`# Title\n${lines(40)}`).shape).toBe("markdown")
    })

    it("draws JSON text by the shape of the parsed value", () => {
        expect(detectValueShape('{"tier": "gold"}')).toEqual({
            shape: "object-flat",
            value: {tier: "gold"},
            parsedFromText: true,
        })
        expect(detectValueShape('[{"sku": "A"}, {"sku": "B"}]').shape).toBe("array-objects")
    })

    it("checks JSON text before markdown", () => {
        const detected = detectValueShape('{"summary": "## Title\\n- one"}')
        expect(detected.shape).toBe("object-flat")
        expect(detected.parsedFromText).toBe(true)
    })

    it("parses JSON inside a code fence", () => {
        expect(detectValueShape('```json\n{"company": "Acme", "employees": 40}\n```')).toEqual({
            shape: "object-flat",
            value: {company: "Acme", employees: 40},
            parsedFromText: true,
        })
    })

    it("keeps cut-off JSON as text", () => {
        const text = '{"company": "Acme", "employ'
        expect(detectValueShape(text)).toEqual({shape: "text-short", value: text})
    })

    it("keeps a JSON number written as text as text", () => {
        expect(detectValueShape("42")).toEqual({shape: "text-short", value: "42"})
        expect(detectValueShape('"42"').shape).toBe("text-short")
    })

    it("names chat messages and one message", () => {
        const chat = [
            {role: "user", content: "Hi"},
            {role: "assistant", content: "Hello"},
        ]
        expect(detectValueShape(chat)).toEqual({shape: "messages", value: chat})
        expect(detectValueShape({role: "assistant", content: "Done."}).shape).toBe("message")
    })

    it("draws messages under a known key as messages and names the key", () => {
        const chat = [{role: "user", content: "Hi"}]
        expect(detectValueShape({messages: chat})).toEqual({
            shape: "messages",
            value: chat,
            key: "messages",
        })
    })

    it("reads the messages of choices[].message", () => {
        const message = {role: "assistant", content: "Paris"}
        expect(detectValueShape({choices: [{index: 0, message}]})).toEqual({
            shape: "messages",
            value: [message],
            key: "choices",
        })
    })

    it("keeps an object with more keys than the messages as an object", () => {
        const value = {messages: [{role: "user", content: "Hi"}], model: "gpt"}
        expect(detectValueShape(value).shape).toBe("object-nested")
    })

    it("splits flat and nested objects", () => {
        expect(detectValueShape({country: "EE", score: 3}).shape).toBe("object-flat")
        expect(detectValueShape({lead: {country: "EE"}}).shape).toBe("object-nested")
        expect(detectValueShape({tags: ["a"]}).shape).toBe("object-nested")
    })

    it("splits arrays of scalars, of objects and of both", () => {
        expect(detectValueShape(["return", "defect", 3]).shape).toBe("array-scalars")
        expect(detectValueShape([{sku: "A"}, {sku: "B"}]).shape).toBe("array-objects")
        expect(detectValueShape([{sku: "A"}, "B"]).shape).toBe("object-nested")
        expect(detectValueShape([[1], [2]]).shape).toBe("object-nested")
    })
})

describe("formatShapeNumber", () => {
    it("prints integers as they are and decimals with three significant digits", () => {
        expect(formatShapeNumber(48213907)).toBe("48213907")
        expect(formatShapeNumber(0.875)).toBe("0.875")
        expect(formatShapeNumber(0.72)).toBe("0.72")
        expect(formatShapeNumber(0.000123456)).toBe("0.000123")
        expect(formatShapeNumber(4218.4)).toBe("4218.4")
        expect(formatShapeNumber(1.23456)).toBe("1.235")
    })
})

describe("readValueMessage", () => {
    it("skips null and cut-short parts", () => {
        const message = readValueMessage({
            role: "user",
            content: [
                null,
                {type: "text", text: "Hello"},
                {type: "image_url"},
                {type: "image_url", image_url: {url: "https://example.com/a.png"}},
            ],
        })
        expect(message.text).toBe("Hello")
        expect(message.attachments).toHaveLength(1)
    })
})
