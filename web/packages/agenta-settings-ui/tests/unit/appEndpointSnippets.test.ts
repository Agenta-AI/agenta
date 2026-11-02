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
                inputSchema: {
                    properties: {country: {type: "string", default: "France"}, topic: {}},
                },
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

    it("Chat app params add an empty user message", () => {
        const params = JSON.parse(
            buildAppEndpointParams({
                inputSchema: null,
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
                inputSchema: null,
                environmentSlug: "none",
                isChat: false,
                appSlug: null,
            }),
        )
        expect(params.references).toEqual({environment: {slug: "none"}})
    })

    it("Params are indented by two spaces", () => {
        const text = buildAppEndpointParams({
            inputSchema: null,
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
        inputSchema: null,
        environmentSlug: "production",
        isChat: false,
        appSlug: "a",
    })
    const chat = buildAppEndpointParams({
        inputSchema: null,
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
            inputSchema: {
                properties: {
                    on: {default: true},
                    off: {default: false},
                    none: {default: null},
                    note: {default: "What's new?"},
                },
            },
            environmentSlug: "production",
            isChat: false,
            appSlug: "a",
        })
        const snippets = buildInvokeAppSnippets({url, params, isChat: false})
        expect(snippets.python).toContain('"on": True')
        expect(snippets.python).toContain('"off": False')
        expect(snippets.python).not.toMatch(/\b(true|false|null)\b/)
        expect(snippets.bash).toContain("What'\\''s new?")
        expect(snippets.typescript).toContain('"on": true')
    })

    it("A non-chat app with a messages input gets no session header", () => {
        const params = buildAppEndpointParams({
            inputSchema: {properties: {messages: {}}},
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
        expect(snippets.typescript).toContain("getConfig('capital', 'prod-eu')")
    })
})
