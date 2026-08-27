import {describe, expect, it} from "vitest"

import {
    transformCustomProviderPayloadData,
    transformSecret,
    transformStandardProviderPayloadData,
} from "../../src/secret/core/transforms"
import {
    SecretKind,
    McpStandardProviderKind,
    StandardProviderKind,
    type SecretResponseDto,
    type StandardProviderDto,
} from "../../src/secret/core/types"

const standardSecret = (data: Partial<StandardProviderDto>): SecretResponseDto =>
    ({
        id: "id-1",
        slug: "openai-2-abcdef123456",
        kind: SecretKind.ProviderKey,
        header: {name: "OpenAI 2"},
        data: {kind: StandardProviderKind.Openai, provider: {key: "sk-one"}, ...data},
    }) as unknown as SecretResponseDto

describe("transformSecret", () => {
    it("carries the saved models and harnesses of a standard connection", () => {
        const [row] = transformSecret([
            standardSecret({
                models: [{slug: "gpt-5.6-luna"}, {slug: "gpt-5.6-sol"}],
                harnesses: ["pi_core", "codex"],
            }),
        ])

        expect(row.models).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"])
        expect(row.harnesses).toEqual(["pi_core", "codex"])
    })

    it("leaves both fields undefined for a record that saved neither", () => {
        const [row] = transformSecret([standardSecret({})])

        // Absent means "use Agenta's defaults" — an empty array would mean "offer nothing".
        expect(row.models).toBeUndefined()
        expect(row.harnesses).toBeUndefined()
        expect(row.key).toBe("sk-one")
        expect(row.name).toBe("OPENAI_API_KEY")
    })

    it("keeps an explicitly empty model list distinct from a missing one", () => {
        const [row] = transformSecret([standardSecret({models: []})])

        expect(row.models).toEqual([])
    })

    it("maps a Composio project key to its vault name", () => {
        const [row] = transformSecret([standardSecret({kind: McpStandardProviderKind.Composio})])

        expect(row.name).toBe("COMPOSIO_API_KEY")
    })

    it("carries the harnesses of a custom-provider connection", () => {
        const [row] = transformSecret([
            {
                id: "id-2",
                kind: SecretKind.CustomProvider,
                header: {name: "my-gateway"},
                data: {
                    kind: "custom",
                    provider: {url: "https://gw.example/v1", extras: {api_key: "sk-gw"}},
                    models: [{slug: "gpt-4o-mini"}],
                    harnesses: ["pi_core"],
                },
            } as unknown as SecretResponseDto,
        ])

        expect(row.harnesses).toEqual(["pi_core"])
        expect(row.models).toEqual(["gpt-4o-mini"])
    })
})

describe("transformStandardProviderPayloadData", () => {
    it("sends the saved models and harnesses when the connection has them", () => {
        const payload = transformStandardProviderPayloadData(
            {
                title: "OpenAI",
                key: "sk-one",
                name: "OPENAI_API_KEY",
                models: ["gpt-5.6-luna"],
                harnesses: ["pi_core"],
            },
            StandardProviderKind.Openai,
        )

        const data = payload.secret.data as StandardProviderDto
        expect(payload.secret.kind).toBe(SecretKind.ProviderKey)
        expect(data.models).toEqual([{slug: "gpt-5.6-luna"}])
        expect(data.harnesses).toEqual(["pi_core"])
    })

    it("sends a hand-typed variant id byte-identically, colon and all", () => {
        // OpenRouter's variant syntax (`vendor/model:variant`). Nothing here may normalize,
        // split on the colon, or re-prefix it — the gateway only answers to the exact id.
        const typed = "deepseek/deepseek-v4-flash:nitro"
        const payload = transformStandardProviderPayloadData(
            {
                title: "OpenRouter",
                key: "sk-or-test",
                name: "OPENROUTER_API_KEY",
                models: ["deepseek/deepseek-v4-flash", typed],
            },
            StandardProviderKind.Openrouter,
        )

        const data = payload.secret.data as StandardProviderDto
        expect(data.models).toEqual([{slug: "deepseek/deepseek-v4-flash"}, {slug: typed}])
    })

    it("omits both fields when the connection has neither", () => {
        const payload = transformStandardProviderPayloadData(
            {title: "OpenAI", key: "sk-one", name: "OPENAI_API_KEY"},
            StandardProviderKind.Openai,
        )

        const data = payload.secret.data as StandardProviderDto
        expect(data).toEqual({kind: StandardProviderKind.Openai, provider: {key: "sk-one"}})
        expect(payload.header.name).toBe("OpenAI")
    })

    it("round-trips a standard connection through the response transform", () => {
        const payload = transformStandardProviderPayloadData(
            {
                title: "OpenAI",
                key: "sk-one",
                name: "OPENAI_API_KEY",
                models: ["gpt-5.6-luna"],
                harnesses: ["codex"],
            },
            StandardProviderKind.Openai,
        )

        const [row] = transformSecret([standardSecret(payload.secret.data as StandardProviderDto)])

        expect(row.models).toEqual(["gpt-5.6-luna"])
        expect(row.harnesses).toEqual(["codex"])
    })
})

describe("transformCustomProviderPayloadData", () => {
    it("sends harnesses when present and omits them otherwise", () => {
        const values = {
            name: "my-gateway",
            provider: "custom",
            apiBaseUrl: "https://gw.example/v1",
            apiKey: "sk-gw",
            models: ["gpt-4o-mini"],
        }

        expect(transformCustomProviderPayloadData(values).secret.data).not.toHaveProperty(
            "harnesses",
        )
        expect(
            transformCustomProviderPayloadData({...values, harnesses: ["claude"]}).secret.data,
        ).toMatchObject({harnesses: ["claude"]})
    })
})
