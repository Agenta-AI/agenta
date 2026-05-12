/**
 * Tests for the Prompts manager — focused on the Zod validation we added at
 * the API boundary (drift detection, gracefully fall through on bad data) and
 * at the function boundary (return-shape assertion).
 *
 * Strategy: stub Environments / Revisions / Applications at the constructor
 * level. The Zod schemas live in `prompts.ts`, so we exercise them by feeding
 * realistic and intentionally malformed revision data through `fetch()`.
 */

import {describe, it, expect, vi, afterEach, beforeEach} from "vitest"

import {AgentaClient} from "@src/client.js"
import {Prompts} from "@src/prompts.js"
import {Applications} from "@src/applications.js"
import {Revisions} from "@src/revisions.js"
import {Environments} from "@src/environments.js"

function buildPrompts(opts: {
    envResolve?: () => Promise<unknown>
    revisionRetrieve?: () => Promise<unknown>
    applicationsList?: () => Promise<unknown[]>
    applicationsFindBySlug?: () => Promise<unknown>
}) {
    const client = new AgentaClient({host: "https://api.test", retries: 1})
    const apps = new Applications(client)
    const revs = new Revisions(client)
    const envs = new Environments(client)

    if (opts.envResolve) vi.spyOn(envs, "resolve").mockImplementation(opts.envResolve)
    if (opts.revisionRetrieve)
        vi.spyOn(revs, "retrieve").mockImplementation(opts.revisionRetrieve)
    if (opts.applicationsList) vi.spyOn(apps, "list").mockImplementation(opts.applicationsList)
    if (opts.applicationsFindBySlug)
        vi.spyOn(apps, "findBySlug").mockImplementation(opts.applicationsFindBySlug)

    return new Prompts(client, apps, revs, envs)
}

describe("Prompts.fetch — Zod validation", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    // ── Return shape validation ─────────────────────────────────────────────

    it("returns a result that matches the PromptFetchResult schema (env path)", async () => {
        const prompts = buildPrompts({
            envResolve: async () => ({
                environment_revision: {
                    data: {
                        references: {
                            "rh-voice.revision": {
                                application: {id: "app-1"},
                                application_revision: {id: "rev-1"},
                            },
                        },
                    },
                },
            }),
            revisionRetrieve: async () => ({
                application_revision: {
                    data: {
                        parameters: {
                            prompt: {
                                messages: [{role: "system", content: "You are helpful."}],
                                template_format: "curly",
                                input_keys: [],
                                llm_config: {model: "anthropic/claude-haiku-4-5"},
                            },
                        },
                    },
                },
            }),
        })

        const result = await prompts.fetch({slugs: ["rh-voice"], environment: "production"})

        // Validation didn't throw → schema matched.
        expect(result.instructions).toBe("You are helpful.")
        expect(result.applicationId).toBe("app-1")
        expect(result.revisionId).toBe("rev-1")
        expect(result.source).toBe("environment")
        expect(result.toolSchemas).toEqual({})
    })

    it("returns a result that matches the schema (fallback-only path)", async () => {
        const prompts = buildPrompts({
            envResolve: async () => {
                throw new Error("env resolve failed")
            },
            applicationsList: async () => [],
        })

        const result = await prompts.fetch({
            slugs: ["rh-voice"],
            environment: "production",
            fallbacks: {"rh-voice": "Local fallback prompt."},
        })

        expect(result.instructions).toBe("Local fallback prompt.")
        expect(result.source).toBe("fallback")
        expect(result.applicationId).toBeNull()
        expect(result.revisionId).toBeNull()
    })

    // ── Boundary validation (safeParse on revision data) ────────────────────

    it("warns on malformed prompt template but still returns a usable result", async () => {
        const prompts = buildPrompts({
            envResolve: async () => ({
                environment_revision: {
                    data: {
                        references: {
                            "rh-voice.revision": {
                                application: {id: "app-1"},
                                application_revision: {id: "rev-1"},
                            },
                        },
                    },
                },
            }),
            revisionRetrieve: async () => ({
                application_revision: {
                    data: {
                        parameters: {
                            prompt: {
                                messages: [{role: 123, content: "wrong types"}], // role should be string
                                llm_config: {model: "x"},
                            },
                        },
                    },
                },
            }),
        })

        const result = await prompts.fetch({
            slugs: ["rh-voice"],
            environment: "production",
            fallbacks: {"rh-voice": "fallback"},
        })

        // safeParse warns to console; the call doesn't throw.
        expect(warnSpy).toHaveBeenCalled()
        const firstWarn = warnSpy.mock.calls[0]?.[0] as string
        expect(firstWarn).toContain("prompt template shape drifted")
        // Falls back to the local fallback because parsing threw and content extraction failed.
        expect(result.instructions).toBe("fallback")
    })

    it("validates tool schemas inside the prompt template", async () => {
        const prompts = buildPrompts({
            envResolve: async () => ({
                environment_revision: {
                    data: {
                        references: {
                            "rh-voice.revision": {
                                application: {id: "app-1"},
                                application_revision: {id: "rev-1"},
                            },
                        },
                    },
                },
            }),
            revisionRetrieve: async () => ({
                application_revision: {
                    data: {
                        parameters: {
                            prompt: {
                                messages: [{role: "system", content: "Hi."}],
                                llm_config: {
                                    model: "x",
                                    tools: [
                                        {
                                            type: "function",
                                            function: {
                                                name: "search",
                                                description: "Search the web",
                                                parameters: {type: "object", properties: {}},
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            }),
        })

        const result = await prompts.fetch({slugs: ["rh-voice"], environment: "production"})

        expect(result.toolSchemas).toHaveProperty("search")
        expect(result.toolSchemas.search.description).toBe("Search the web")
        expect(warnSpy).not.toHaveBeenCalled()
    })

    it("legacy prompt_text path still works (no template object at all)", async () => {
        const prompts = buildPrompts({
            envResolve: async () => ({
                environment_revision: {
                    data: {
                        references: {
                            "legacy.revision": {
                                application: {id: "app-2"},
                                application_revision: {id: "rev-2"},
                            },
                        },
                    },
                },
            }),
            revisionRetrieve: async () => ({
                application_revision: {
                    data: {
                        parameters: {
                            prompt_text: "Old format prompt.",
                        },
                    },
                },
            }),
        })

        const result = await prompts.fetch({slugs: ["legacy"], environment: "production"})

        expect(result.instructions).toBe("Old format prompt.")
        expect(warnSpy).not.toHaveBeenCalled()
    })
})
