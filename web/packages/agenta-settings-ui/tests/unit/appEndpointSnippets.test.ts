import {describe, expect, it} from "vitest"

import {
    buildAppEndpointParams,
    buildFetchConfigSnippets,
    buildInvokeAppSnippets,
} from "../../src/publish/snippets/appEndpoint"

const LANGS = ["python", "bash", "typescript"] as const

describe("app endpoint params", () => {
    it("Invoke params list every schema input with its default or add_a_value", () => {
        const params = JSON.parse(
            buildAppEndpointParams({
                inputs: [
                    {key: "country", schema: {type: "string", default: "France"}},
                    {key: "topic"},
                ],
                environmentSlug: "production",
                isChat: false,
                appSlug: "capital",
            }),
        )
        expect(params.data.inputs).toEqual({country: "France", topic: "add_a_value"})
        expect(params.references).toEqual({
            application: {slug: "capital"},
            environment: {slug: "production"},
        })
    })

    it("Prompt variables without a schema get the add_a_value placeholder", () => {
        const params = JSON.parse(
            buildAppEndpointParams({
                inputs: [{key: "country"}],
                environmentSlug: "development",
                isChat: false,
                appSlug: "capital",
            }),
        )
        expect(params.data.inputs).toEqual({country: "add_a_value"})
    })

    it("A chat app keeps its prompt variables next to the user message", () => {
        const params = JSON.parse(
            buildAppEndpointParams({
                inputs: [{key: "country"}, {key: "messages"}],
                environmentSlug: "development",
                isChat: true,
                appSlug: "bot",
            }),
        )
        expect(params.data.inputs).toEqual({
            country: "add_a_value",
            messages: [{role: "user", content: ""}],
        })
    })

    it("Odd variable names stay quoted in every language", () => {
        const params = buildAppEndpointParams({
            inputs: [{key: `it's "x"`}],
            environmentSlug: "development",
            isChat: false,
            appSlug: "a",
        })
        const snippets = buildInvokeAppSnippets({url: "https://x/invoke", params, isChat: false})
        expect(snippets.python).toContain(`"it's \\"x\\"": "add_a_value"`)
        expect(snippets.bash).toContain(`"it'\\''s \\"x\\"": "add_a_value"`)
        expect(snippets.typescript).toContain(`"it's \\"x\\"": "add_a_value"`)
    })

    it("Chat app params add an empty user message", () => {
        const params = JSON.parse(
            buildAppEndpointParams({
                inputs: [],
                environmentSlug: "staging",
                isChat: true,
                appSlug: "bot",
            }),
        )
        expect(params.data.inputs.messages).toEqual([{role: "user", content: ""}])
    })

    it("Params omit the application reference when the app has no slug", () => {
        const params = JSON.parse(
            buildAppEndpointParams({
                inputs: [],
                environmentSlug: "none",
                isChat: false,
                appSlug: null,
            }),
        )
        expect(params.references).toEqual({environment: {slug: "none"}})
    })

    it("Params are indented by two spaces", () => {
        const text = buildAppEndpointParams({
            inputs: [],
            environmentSlug: "none",
            isChat: false,
            appSlug: null,
        })
        expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2))
    })
})

describe("invoke snippets", () => {
    const url = "https://api.example.com/services/x/invoke"
    const plain = buildAppEndpointParams({
        inputs: [],
        environmentSlug: "production",
        isChat: false,
        appSlug: "a",
    })
    const chat = buildAppEndpointParams({
        inputs: [],
        environmentSlug: "production",
        isChat: true,
        appSlug: "a",
    })

    it("Chat invoke snippets send the session baggage header in all three languages", () => {
        const snippets = buildInvokeAppSnippets({url, params: chat, isChat: true, apiKey: "K"})
        for (const lang of LANGS) {
            expect(snippets[lang]).toContain("ag.session.id=your_session_id")
        }
        const plainSnippets = buildInvokeAppSnippets({
            url,
            params: plain,
            isChat: false,
            apiKey: "K",
        })
        for (const lang of LANGS) {
            expect(plainSnippets[lang]).not.toContain("Baggage")
        }
    })

    it("Snippets use the YOUR_API_KEY placeholder when no key is given", () => {
        const snippets = buildInvokeAppSnippets({url, params: plain, isChat: false})
        for (const lang of LANGS) {
            expect(snippets[lang]).toContain("ApiKey YOUR_API_KEY")
            expect(snippets[lang]).toContain(url)
        }
        const fetched = buildFetchConfigSnippets({
            apiUrl: "https://api.example.com",
            appSlug: "a",
            environmentSlug: "production",
        })
        expect(fetched.python).toContain('"YOUR_API_KEY"')
        expect(fetched.bash).toContain("ApiKey YOUR_API_KEY")
        expect(fetched.typescript).toContain("ApiKey YOUR_API_KEY")
        expect(fetched.python).not.toContain('= ""')
    })

    it("Python and cURL stay valid for boolean, null and apostrophe defaults", () => {
        const params = buildAppEndpointParams({
            inputs: [
                {key: "on", schema: {default: true}},
                {key: "off", schema: {default: false}},
                {key: "none", schema: {default: null}},
                {key: "note", schema: {default: "What's new?"}},
            ],
            environmentSlug: "production",
            isChat: false,
            appSlug: "a",
        })
        const snippets = buildInvokeAppSnippets({url, params, isChat: false})
        expect(snippets.python).toContain('"on": True')
        expect(snippets.python).toContain('"off": False')
        expect(snippets.python).toContain('"none": None')
        expect(snippets.bash).toContain('"none": null')
        expect(snippets.python).not.toMatch(/\b(true|false|null)\b/)
        expect(snippets.bash).toContain("What'\\''s new?")
        expect(snippets.typescript).toContain('"on": true')
    })

    it("Every language keeps nested, numeric and quoted defaults and a quoted URL", () => {
        const params = buildAppEndpointParams({
            inputs: [
                {key: "n", schema: {default: 1.5}},
                {key: "text", schema: {default: 'say "hi" \\ it\'s'}},
                {
                    key: "nested",
                    schema: {
                        default: JSON.parse('{"list":[1,null,true],"deep":{"__proto__":{"x":1}}}'),
                    },
                },
            ],
            environmentSlug: "production",
            isChat: false,
            appSlug: "a",
        })
        const snippets = buildInvokeAppSnippets({
            url: "https://example.com/team's-app/invoke",
            params,
            isChat: false,
        })
        expect(snippets.bash).toContain("team'\\''s-app")
        expect(snippets.bash).toContain("it'\\''s")
        expect(snippets.typescript).toContain(
            'const url = "https://example.com/team\'s-app/invoke"',
        )
        expect(snippets.typescript).toContain("JSON.parse(")
        expect(snippets.python).toContain('url = "https://example.com/team\'s-app/invoke"')
        expect(snippets.python).toContain('"n": 1.5')
        expect(snippets.python).toContain('"list": [\n')
        expect(snippets.python).toContain('"text": "say \\"hi\\" \\\\ it\'s"')
        expect(snippets.python).not.toMatch(/\b(true|false|null)\b/)
    })

    it("A non-chat app with a messages input gets no session header", () => {
        const params = buildAppEndpointParams({
            inputs: [{key: "messages"}],
            environmentSlug: "production",
            isChat: false,
            appSlug: "a",
        })
        const snippets = buildInvokeAppSnippets({url, params, isChat: false})
        expect(snippets.bash).not.toContain("Baggage")
    })

    it("Invoke snippets use the given key", () => {
        const snippets = buildInvokeAppSnippets({
            url,
            params: plain,
            isChat: false,
            apiKey: "secret",
        })
        expect(snippets.bash).toContain("ApiKey secret")
        expect(snippets.bash).not.toContain("YOUR_API_KEY")
    })
})

describe("fetch config snippets", () => {
    it("Odd slugs stay inside the string, the shell argument and the JSON body", () => {
        const snippets = buildFetchConfigSnippets({
            apiUrl: "https://api.example.com",
            appSlug: 'a"b',
            environmentSlug: "team's-prod",
        })
        expect(snippets.python).toContain('environment_slug="team\'s-prod"')
        expect(snippets.python).toContain('app_slug="a\\"b"')
        expect(snippets.typescript).toContain('getConfig("a\\"b", "team\'s-prod")')
        expect(snippets.bash).toContain("team'\\''s-prod")
        expect(snippets.bash).toContain('a\\"b')
    })

    it("Fetch config snippets reference the environment slug", () => {
        const snippets = buildFetchConfigSnippets({
            apiUrl: "https://api.example.com",
            appSlug: "capital",
            environmentSlug: "prod-eu",
            apiKey: "K",
        })
        expect(snippets.python).toContain('app_slug="capital"')
        expect(snippets.python).toContain('environment_slug="prod-eu"')
        expect(snippets.python).toContain(
            'os.environ["AGENTA_API_URL"] = "https://api.example.com"',
        )
        expect(snippets.bash).toContain("https://api.example.com/applications/revisions/retrieve")
        expect(snippets.bash).toContain('"slug": "prod-eu"')
        expect(snippets.bash).toContain('"slug": "capital"')
        expect(snippets.typescript).toContain('getConfig("capital", "prod-eu")')
    })
})
