import {describe, expect, it, vi} from "vitest"

import {
    activeModelsCount,
    credentialStatusLine,
    harnessSummary,
    manualModelPlaceholderForKind,
    MODEL_LIST_RENDER_CAP,
    modelListView,
    relativeFetchTime,
    secretNoteForKind,
} from "../../src/secret/core/cardCopy"

describe("credentialStatusLine", () => {
    it("joins the provider's verdict to what the same call fetched", () => {
        expect(credentialStatusLine("OpenAI accepted this key.", 41)).toBe(
            "OpenAI accepted this key · 41 models fetched",
        )
    })

    it("names the endpoint the API named, not the provider family", () => {
        expect(credentialStatusLine("api.openai.com accepted this key.", 9)).toBe(
            "api.openai.com accepted this key · 9 models fetched",
        )
    })

    it("drops the API's full stop so the separator reads as one", () => {
        expect(credentialStatusLine("OpenAI accepted this key.", 41)).not.toContain("key. ·")
    })

    it("counts one model in the singular", () => {
        expect(credentialStatusLine("Groq accepted this key.", 1)).toBe(
            "Groq accepted this key · 1 model fetched",
        )
    })

        it("says nothing about a fetch that did not happen, and keeps its own full stop", () => {
        expect(credentialStatusLine("OpenAI rejected this key (401).", null)).toBe(
            "OpenAI rejected this key (401).",
        )
    })
})

describe("activeModelsCount", () => {
    it("counts what is checked against what was fetched", () => {
        expect(activeModelsCount(3, 41)).toBe("3 of 41")
    })

    it("never claims a choice the user did not make", () => {
        expect(activeModelsCount(0, 9)).toBe("0 of 9")
    })
})

describe("modelListView", () => {
    it("never offers 'Show all' when every row is already rendered", () => {
        for (const total of [0, 1, 12, 25, 40, MODEL_LIST_RENDER_CAP]) {
            const view = modelListView({total, showAll: false})
            expect(view.truncated).toBe(false)
            expect(view.visibleCount).toBe(total)
        }
    })

    it("renders a typical provider's whole list — 25 models is the normal case, not an overflow", () => {
        expect(modelListView({total: 25, showAll: false})).toEqual({
            truncated: false,
            visibleCount: 25,
        })
    })

    it("caps only a list big enough for mounting it to be the real cost", () => {
        const view = modelListView({total: 400, showAll: false})
        expect(view.truncated).toBe(true)
        expect(view.visibleCount).toBe(MODEL_LIST_RENDER_CAP)
    })

    it("keeps the full list once it has been asked for", () => {
        expect(modelListView({total: 400, showAll: true})).toEqual({
            truncated: false,
            visibleCount: 400,
        })
    })

    it("decides on the row count alone, so no height measurement can make it flicker", () => {
        const first = modelListView({total: 61, showAll: false})
        const second = modelListView({total: 61, showAll: false})
        expect(first).toEqual(second)
        expect(first.truncated).toBe(true)
    })
})

describe("secretNoteForKind", () => {
    it("says what Test does with a standard provider's key", () => {
        expect(secretNoteForKind("openai", "OpenAI")).toBe(
            "Test checks the key with OpenAI and fetches its model list. Nothing is saved until Done.",
        )
    })

    it("tests a credential-set connection by reaching the address it names", () => {
        expect(secretNoteForKind("custom", "OpenAI-compatible endpoint")).toBe(
            "Test pings the endpoint and fetches its model list. Nothing is saved until Done.",
        )
        // Vertex's credential is a service-account JSON, so "the key" would misdescribe it.
        expect(secretNoteForKind("vertex_ai", "Google Vertex AI")).not.toContain("the key")
    })

    it("promises the same thing in both cases: nothing lands before Done", () => {
        for (const kind of ["openai", "custom", "bedrock"]) {
            expect(secretNoteForKind(kind, "X")).toContain("Nothing is saved until Done.")
        }
    })
})

describe("manualModelPlaceholderForKind", () => {
    it("adds against the API's list for a standard provider", () => {
        expect(manualModelPlaceholderForKind("openai")).toBe("Add a model ID the API doesn't list")
    })

    it("adds against the endpoint's list for a credential-set connection", () => {
        expect(manualModelPlaceholderForKind("custom")).toBe(
            "Add a model ID the endpoint doesn't list",
        )
    })
})

describe("harnessSummary", () => {
    it("shows the collapsed row's value rather than hiding it", () => {
        expect(harnessSummary(["Pi"], false)).toBe("enabled in Pi")
    })

    it("lists several harnesses in one line", () => {
        expect(harnessSummary(["Pi", "Claude Code", "Codex"], false)).toBe(
            "enabled in Pi, Claude Code and Codex",
        )
    })

    it("separates 'nobody chose' from 'the user chose none'", () => {
        expect(harnessSummary([], true)).toBe("any harness Agenta supports")
        expect(harnessSummary([], false)).toBe("no harness selected")
    })
})

describe("relativeFetchTime", () => {
    it("reads a fresh fetch as just now", () => {
        vi.setSystemTime(new Date("2026-08-13T12:00:00Z"))
        expect(relativeFetchTime("2026-08-13T11:59:40Z")).toBe("just now")
        vi.useRealTimers()
    })

    it("steps up through minutes, hours, and days", () => {
        vi.setSystemTime(new Date("2026-08-13T12:00:00Z"))
        expect(relativeFetchTime("2026-08-13T11:58:00Z")).toBe("2 min ago")
        expect(relativeFetchTime("2026-08-13T09:00:00Z")).toBe("3 h ago")
        expect(relativeFetchTime("2026-08-11T12:00:00Z")).toBe("2 d ago")
        vi.useRealTimers()
    })

    it("treats a clock-skewed future timestamp as just now, not a negative age", () => {
        vi.setSystemTime(new Date("2026-08-13T12:00:00Z"))
        expect(relativeFetchTime("2026-08-13T12:05:00Z")).toBe("just now")
        vi.useRealTimers()
    })
})
