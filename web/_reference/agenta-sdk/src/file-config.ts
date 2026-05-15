/**
 * File-based config loading.
 *
 * Mirrors the Python SDK's `ag.ConfigManager.get_from_yaml()` and
 * `get_from_json()` (sdk/agenta/sdk/managers/config.py:155-214). Both
 * functions read a config file from disk and optionally validate against
 * a Zod schema (Python uses Pydantic).
 *
 * Node-only. Browser callers will get the same module-resolution error
 * Node would (no `fs/promises` polyfill).
 *
 * JSON support has no peer dependency. YAML support requires the `yaml`
 * package — installed as a peer dep so it's only paid for when used.
 */

import type {ZodType} from "zod"

/**
 * Load and parse a JSON config file.
 *
 * @example
 * ```ts
 * import {loadFromJson} from "@agenta/sdk"
 * import {z} from "zod"
 *
 * // Without validation — returns parsed JSON as `unknown`.
 * const raw = await loadFromJson("./config.json")
 *
 * // With a Zod schema — returns the typed result.
 * const Config = z.object({apiKey: z.string(), host: z.string().url()})
 * const config = await loadFromJson("./config.json", Config)
 * config.apiKey // typed as string
 * ```
 *
 * @throws If the file doesn't exist or can't be read.
 * @throws `SyntaxError` if the file isn't valid JSON.
 * @throws `ZodError` if a schema is provided and the parsed data doesn't match.
 */
export async function loadFromJson<T>(filePath: string, schema?: ZodType<T>): Promise<T>
export async function loadFromJson(filePath: string): Promise<unknown>
export async function loadFromJson<T>(filePath: string, schema?: ZodType<T>): Promise<T | unknown> {
    const {readFile} = await import("node:fs/promises")
    const text = await readFile(filePath, "utf-8")
    const parsed: unknown = JSON.parse(text)

    if (schema) {
        return schema.parse(parsed)
    }
    return parsed
}

/**
 * Load and parse a YAML config file.
 *
 * Requires the `yaml` package to be installed (declared as a peer dep so
 * consumers who don't use YAML pay nothing). If `yaml` isn't found, a clear
 * error tells the user how to fix it.
 *
 * @example
 * ```ts
 * import {loadFromYaml} from "@agenta/sdk"
 * import {z} from "zod"
 *
 * const raw = await loadFromYaml("./config.yaml")
 * const config = await loadFromYaml("./config.yaml", MyConfigSchema)
 * ```
 *
 * @throws If the file doesn't exist or can't be read.
 * @throws If the `yaml` package isn't installed (with install instructions).
 * @throws If the file isn't valid YAML.
 * @throws `ZodError` if a schema is provided and the parsed data doesn't match.
 */
export async function loadFromYaml<T>(filePath: string, schema?: ZodType<T>): Promise<T>
export async function loadFromYaml(filePath: string): Promise<unknown>
export async function loadFromYaml<T>(filePath: string, schema?: ZodType<T>): Promise<T | unknown> {
    const {readFile} = await import("node:fs/promises")
    const text = await readFile(filePath, "utf-8")

    let yamlModule: {parse: (input: string) => unknown}
    try {
        yamlModule = (await import("yaml")) as unknown as {parse: (input: string) => unknown}
    } catch {
        throw new Error(
            "YAML support requires the `yaml` package. Install it with: " +
                "`pnpm add yaml` (or `npm install yaml` / `bun add yaml`).",
        )
    }

    const parsed: unknown = yamlModule.parse(text)

    if (schema) {
        return schema.parse(parsed)
    }
    return parsed
}
