/**
 * Tests for `loadFromJson` and `loadFromYaml`. These hit the real filesystem
 * via temp files so we exercise the same code path the SDK ships.
 */

import {mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"

import {describe, it, expect, beforeAll, afterAll} from "vitest"
import {z} from "zod"

import {loadFromJson, loadFromYaml} from "@src/file-config.js"

const ConfigSchema = z.object({
    apiKey: z.string(),
    host: z.string().url(),
    timeoutMs: z.number().int().positive(),
})

let workDir: string

beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "agenta-sdk-fileconfig-"))
})

afterAll(async () => {
    await rm(workDir, {recursive: true, force: true})
})

describe("loadFromJson", () => {
    it("parses a JSON file and returns the raw value when no schema is given", async () => {
        const path = join(workDir, "config.json")
        await writeFile(path, JSON.stringify({foo: "bar", n: 42}))

        const result = await loadFromJson(path)
        expect(result).toEqual({foo: "bar", n: 42})
    })

    it("validates against a Zod schema when one is provided", async () => {
        const path = join(workDir, "valid.json")
        await writeFile(
            path,
            JSON.stringify({apiKey: "sk-123", host: "https://cloud.example.com", timeoutMs: 5000}),
        )

        const result = await loadFromJson(path, ConfigSchema)
        // Type-narrowed to the schema's inferred type.
        expect(result.apiKey).toBe("sk-123")
        expect(result.host).toBe("https://cloud.example.com")
        expect(result.timeoutMs).toBe(5000)
    })

    it("throws ZodError when the JSON shape doesn't match the schema", async () => {
        const path = join(workDir, "invalid.json")
        await writeFile(path, JSON.stringify({apiKey: 123, host: "not-a-url", timeoutMs: -1}))

        await expect(loadFromJson(path, ConfigSchema)).rejects.toThrow()
    })

    it("throws SyntaxError on malformed JSON", async () => {
        const path = join(workDir, "broken.json")
        await writeFile(path, "{this is not json")

        await expect(loadFromJson(path)).rejects.toThrow(SyntaxError)
    })

    it("throws when the file doesn't exist", async () => {
        const path = join(workDir, "does-not-exist.json")
        await expect(loadFromJson(path)).rejects.toThrow()
    })
})

describe("loadFromYaml", () => {
    it("parses a YAML file and returns the raw value when no schema is given", async () => {
        const path = join(workDir, "config.yaml")
        await writeFile(path, "foo: bar\nn: 42\n")

        const result = await loadFromYaml(path)
        expect(result).toEqual({foo: "bar", n: 42})
    })

    it("validates against a Zod schema when one is provided", async () => {
        const path = join(workDir, "valid.yaml")
        await writeFile(
            path,
            ["apiKey: sk-123", "host: https://cloud.example.com", "timeoutMs: 5000", ""].join(
                "\n",
            ),
        )

        const result = await loadFromYaml(path, ConfigSchema)
        expect(result.apiKey).toBe("sk-123")
        expect(result.host).toBe("https://cloud.example.com")
        expect(result.timeoutMs).toBe(5000)
    })

    it("throws ZodError when the YAML shape doesn't match the schema", async () => {
        const path = join(workDir, "invalid.yaml")
        await writeFile(path, "apiKey: 123\nhost: not-a-url\ntimeoutMs: -1\n")

        await expect(loadFromYaml(path, ConfigSchema)).rejects.toThrow()
    })

    it("throws when the file doesn't exist", async () => {
        const path = join(workDir, "does-not-exist.yaml")
        await expect(loadFromYaml(path)).rejects.toThrow()
    })

    it("nested YAML structures decode correctly", async () => {
        const path = join(workDir, "nested.yaml")
        await writeFile(
            path,
            [
                "agent:",
                "  name: support-bot",
                "  tools:",
                "    - search",
                "    - escalate",
                "limits:",
                "  rps: 5",
                "",
            ].join("\n"),
        )

        const result = (await loadFromYaml(path)) as {
            agent: {name: string; tools: string[]}
            limits: {rps: number}
        }
        expect(result.agent.name).toBe("support-bot")
        expect(result.agent.tools).toEqual(["search", "escalate"])
        expect(result.limits.rps).toBe(5)
    })
})
