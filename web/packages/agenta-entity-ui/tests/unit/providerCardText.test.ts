/**
 * The provider card's text. English is pinned byte for byte as it was before translation; the
 * other languages are checked for their own words, plural forms, relative times and list
 * separators.
 */
import type {ProviderConnection} from "@agenta/entities/secret"
import {SecretKind} from "@agenta/entities/secret"
import {activeLanguageAtom, type Language} from "@agenta/i18n"
import {languageAtom, useLanguageSync} from "@agenta/i18n/language"
import {getDefaultStore} from "jotai"
import {act, createElement} from "react"
import {createRoot} from "react-dom/client"
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest"

import {
    activeModelsCount,
    connectedRowSubtitle,
    credentialStatusLine,
    credentialSummaryText,
    manualModelPlaceholder,
    probeFailureText,
    relativeFetchTime,
    testNote,
} from "../../src/secretProvider/providerCardText"
import {
    subscriptionAttemptErrorSentence,
    subscriptionSignInHint,
    subscriptionStatusLine,
} from "../../src/secretProvider/subscriptionText"

const store = getDefaultStore()

/** Switches the language the way the app does, and waits until its catalogs have loaded. */
const inLanguage = (language: Language) => {
    let previous: {chosen: Language; active: Language}
    beforeAll(async () => {
        previous = {chosen: store.get(languageAtom), active: store.get(activeLanguageAtom)}
        store.set(languageAtom, language)
        const Sync = () => {
            useLanguageSync()
            return null
        }
        const root = createRoot(document.createElement("div"))
        await act(async () => root.render(createElement(Sync)))
        await vi.waitFor(() => expect(store.get(activeLanguageAtom)).toBe(language))
        act(() => root.unmount())
    })
    afterAll(() => {
        store.set(languageAtom, previous.chosen)
        store.set(activeLanguageAtom, previous.active)
    })
}

const connection = (overrides: Partial<ProviderConnection> = {}): ProviderConnection => ({
    id: "id",
    name: "OpenAI",
    kind: "openai",
    title: "OpenAI",
    secretKind: SecretKind.ProviderKey,
    source: {},
    ...overrides,
})

const httpError = (status: number) => ({response: {status}})

describe("provider card text in English", () => {
    afterEach(() => vi.useRealTimers())

    it("says what Test does with a key or an endpoint", () => {
        expect(testNote("openai", "OpenAI")).toBe(
            "Test checks the key with OpenAI and fetches its model list. Nothing is saved until Done.",
        )
        expect(testNote("custom", "OpenAI-compatible endpoint")).toBe(
            "Test pings the endpoint and fetches its model list. Nothing is saved until Done.",
        )
        // Vertex's credential is a service-account JSON, so "the key" would misdescribe it.
        expect(testNote("vertex_ai", "Google Vertex AI")).not.toContain("the key")
    })

    it("adds a model ID against the API's list or the endpoint's", () => {
        expect(manualModelPlaceholder("openai")).toBe("Add a model ID the API doesn't list")
        expect(manualModelPlaceholder("custom")).toBe("Add a model ID the endpoint doesn't list")
    })

    it("joins the provider's verdict to what the same call fetched", () => {
        expect(credentialStatusLine("OpenAI accepted this key.", 41)).toBe(
            "OpenAI accepted this key · 41 models fetched",
        )
        expect(credentialStatusLine("Groq accepted this key.", 1)).toBe(
            "Groq accepted this key · 1 model fetched",
        )
        expect(credentialStatusLine("OpenAI rejected this key (401).", null)).toBe(
            "OpenAI rejected this key (401)",
        )
    })

    it("counts what is checked against what was fetched", () => {
        expect(activeModelsCount(3, 41)).toBe("3 of 41")
    })

    it("steps up through minutes, hours and days", () => {
        vi.setSystemTime(new Date("2026-08-13T12:00:00Z"))
        expect(relativeFetchTime("2026-08-13T11:59:40Z")).toBe("just now")
        expect(relativeFetchTime("2026-08-13T11:58:00Z")).toBe("2 min ago")
        expect(relativeFetchTime("2026-08-13T09:00:00Z")).toBe("3 h ago")
        expect(relativeFetchTime("2026-08-11T12:00:00Z")).toBe("2 d ago")
        // A clock-skewed future timestamp is not a negative age.
        expect(relativeFetchTime("2026-08-13T12:05:00Z")).toBe("just now")
    })

    it("says why a Test gave no verdict", () => {
        expect(probeFailureText(httpError(404), "OpenAI")).toBe(
            "This connection no longer exists. Reload and try again.",
        )
        expect(probeFailureText(new Error("network down"), "OpenAI")).toBe(
            "Agenta could not reach OpenAI to test this credential.",
        )
    })

    it("shows a stored key the API does not return", () => {
        expect(credentialSummaryText(connection({hasStoredCredential: true}))).toBe(
            "Key configured",
        )
    })

    it("folds credential, model count and harnesses into one line", () => {
        expect(
            connectedRowSubtitle({
                credential: "sk-••••AAA",
                modelCount: 3,
                harnessLabels: ["Pi", "Claude Code"],
            }),
        ).toBe("sk-••••AAA · 3 models · Pi, Claude Code")
        expect(
            connectedRowSubtitle({credential: "sk-••••AAA", modelCount: 1, harnessLabels: ["Pi"]}),
        ).toBe("sk-••••AAA · 1 model · Pi")
        expect(connectedRowSubtitle({credential: "—", modelCount: 0, harnessLabels: []})).toBe(
            "0 models",
        )
    })

    it("names each subscription state and never shows the server's slug", () => {
        expect(subscriptionSignInHint()).toBe("Sign in needed")
        expect(subscriptionStatusLine({provider: "chatgpt", loginState: "ready"})).toBe("Connected")
        expect(subscriptionStatusLine({provider: "chatgpt", loginState: "pending_login"})).toBe(
            "Not signed in",
        )
        expect(subscriptionStatusLine({provider: "chatgpt", loginState: "needs_login"})).toBe(
            "Sign in needed",
        )
        expect(
            subscriptionStatusLine({
                provider: "chatgpt",
                loginState: "needs_login",
                loginError: "refresh_rejected",
            }),
        ).toBe("Sign in needed. The ChatGPT sign-in is no longer valid.")
        expect(
            subscriptionStatusLine({
                provider: "grok",
                loginState: "needs_login",
                loginError: "something_new",
            }),
        ).toBe("Sign in needed. The grok sign-in needs to be renewed.")
        expect(subscriptionStatusLine(null)).toBe("")
    })

    it("says what happened to a sign-in attempt", () => {
        expect(subscriptionAttemptErrorSentence("attempt not found; try again")).toBe(
            "Agenta lost track of that sign-in. Start it again.",
        )
        expect(subscriptionAttemptErrorSentence("invalid_login")).toBe(
            "ChatGPT returned a sign-in Agenta cannot use. Try again.",
        )
        expect(subscriptionAttemptErrorSentence("access_denied", "grok")).toBe(
            "The grok sign-in was declined.",
        )
        expect(subscriptionAttemptErrorSentence("expired_token")).toBe(
            "The sign-in code expired. Start again.",
        )
        expect(subscriptionAttemptErrorSentence(null)).toBe(
            "The sign-in did not complete. Try again.",
        )
    })
})

describe("provider card text in Japanese", () => {
    inLanguage("ja-JP")
    afterEach(() => vi.useRealTimers())

    it("translates the hint, the counts and the list separator", () => {
        expect(testNote("openai", "OpenAI")).toBe(
            "テストでは OpenAI でキーを確認し、モデル一覧を取得します。「完了」を押すまで何も保存されません。",
        )
        expect(credentialStatusLine("OpenAI accepted this key.", 41)).toBe(
            "OpenAI accepted this key · 41 件のモデルを取得",
        )
        expect(
            connectedRowSubtitle({
                credential: "sk-••••AAA",
                modelCount: 3,
                harnessLabels: ["Pi", "Claude Code", "Codex"],
            }),
        ).toBe("sk-••••AAA · 3 件のモデル · Pi、Claude Code、Codex")
        expect(subscriptionSignInHint()).toBe("サインインが必要")
    })

    it("gives the fetch time from Intl in the language", () => {
        vi.setSystemTime(new Date("2026-08-13T12:00:00Z"))
        expect(relativeFetchTime("2026-08-13T11:58:00Z")).toBe(
            new Intl.RelativeTimeFormat("ja-JP", {style: "short", numeric: "auto"}).format(
                -2,
                "minute",
            ),
        )
    })
})

describe("provider card text in French", () => {
    inLanguage("fr-FR")

    it("uses the French plural forms", () => {
        expect(credentialStatusLine("OpenAI accepted this key.", 1)).toBe(
            "OpenAI accepted this key · 1 modèle récupéré",
        )
        expect(credentialStatusLine("OpenAI accepted this key.", 9)).toBe(
            "OpenAI accepted this key · 9 modèles récupérés",
        )
        expect(activeModelsCount(3, 41)).toBe("3 sur 41")
        expect(probeFailureText(httpError(500), "OpenAI")).toBe(
            "Agenta n’a pas pu joindre OpenAI pour tester cet identifiant.",
        )
    })
})
