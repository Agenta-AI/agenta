/**
 * Unit tests for port extraction helpers
 *
 * These are pure functions — no Jotai, no API. They transform JSON schemas
 * and template placeholder strings into RunnablePort arrays and grouped
 * variable lists. Correctness here directly affects which input fields the
 * playground renders for a given workflow.
 */

import {describe, it, expect} from "vitest"

import {
    resolveSchemaRef,
    resolveSchemaType,
    extractLastPathSegment,
    formatKeyAsName,
    groupTemplateVariables,
    extractInputPortsFromSchema,
    extractOutputPortsFromSchema,
    extractSystemFieldNames,
} from "../../src/runnable/portHelpers"

// ── resolveSchemaRef ──────────────────────────────────────────────────────────

describe("resolveSchemaRef", () => {
    it("returns the node unchanged when there is no $ref", () => {
        const node = {type: "string", title: "Name"}
        expect(resolveSchemaRef(node)).toEqual(node)
    })

    it("resolves a $defs reference", () => {
        const defs = {MyType: {type: "integer", title: "Count"}}
        const node = {$ref: "#/$defs/MyType"}
        expect(resolveSchemaRef(node, defs)).toEqual({type: "integer", title: "Count"})
    })

    it("resolves a #/definitions reference", () => {
        const defs = {Score: {type: "number"}}
        const node = {$ref: "#/definitions/Score"}
        expect(resolveSchemaRef(node, defs)).toEqual({type: "number"})
    })

    it("returns the node as-is when the ref target is missing", () => {
        const node = {$ref: "#/$defs/Missing"}
        expect(resolveSchemaRef(node, {})).toEqual(node)
    })

    it("returns empty object for non-object input", () => {
        expect(resolveSchemaRef(null)).toEqual({})
        expect(resolveSchemaRef("string")).toEqual({})
    })
})

// ── resolveSchemaType ─────────────────────────────────────────────────────────

describe("resolveSchemaType", () => {
    it("returns the type from a plain schema node", () => {
        expect(resolveSchemaType({type: "integer"})).toBe("integer")
    })

    it("resolves the type through a $ref", () => {
        const defs = {Score: {type: "number"}}
        expect(resolveSchemaType({$ref: "#/$defs/Score"}, defs)).toBe("number")
    })

    it("defaults to 'string' when type is not present", () => {
        expect(resolveSchemaType({})).toBe("string")
        expect(resolveSchemaType(null)).toBe("string")
    })
})

// ── extractLastPathSegment ────────────────────────────────────────────────────

describe("extractLastPathSegment", () => {
    it("returns a plain name unchanged", () => {
        expect(extractLastPathSegment("country")).toBe("country")
    })

    it("extracts the last segment from a JSONPath expression", () => {
        expect(extractLastPathSegment("$.inputs.country")).toBe("country")
        expect(extractLastPathSegment("$.outputs.score")).toBe("score")
    })

    it("handles JSONPath with array brackets", () => {
        expect(extractLastPathSegment("$.inputs['key']")).toBe("key")
    })

    it("extracts the last segment from a JSON Pointer", () => {
        expect(extractLastPathSegment("/inputs/country")).toBe("country")
    })

    it("extracts the last segment from dot notation", () => {
        expect(extractLastPathSegment("inputs.country")).toBe("country")
        expect(extractLastPathSegment("a.b.c")).toBe("c")
    })

    it("returns the key unchanged when there is no path syntax", () => {
        expect(extractLastPathSegment("myField")).toBe("myField")
    })

    it("returns the input unchanged for an empty string", () => {
        expect(extractLastPathSegment("")).toBe("")
    })
})

// ── formatKeyAsName ───────────────────────────────────────────────────────────

describe("formatKeyAsName", () => {
    it("converts snake_case to Title Case", () => {
        expect(formatKeyAsName("user_name")).toBe("User name")
    })

    it("splits camelCase on word boundaries", () => {
        expect(formatKeyAsName("firstName")).toBe("First Name")
    })

    it("capitalises the first letter", () => {
        expect(formatKeyAsName("country")).toBe("Country")
    })

    it("strips JSONPath prefix before formatting", () => {
        expect(formatKeyAsName("$.inputs.user_name")).toBe("User name")
    })

    it("strips JSON Pointer prefix before formatting", () => {
        expect(formatKeyAsName("/inputs/score")).toBe("Score")
    })
})

// ── groupTemplateVariables ────────────────────────────────────────────────────

describe("groupTemplateVariables", () => {
    it("returns an empty array for empty input", () => {
        expect(groupTemplateVariables([])).toEqual([])
    })

    it("groups a plain variable into the inputs envelope", () => {
        const result = groupTemplateVariables(["country"])
        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({envelope: "inputs", key: "country", type: "string"})
    })

    it("groups a JSONPath variable into the correct envelope", () => {
        const result = groupTemplateVariables(["$.inputs.city"])
        expect(result[0]).toMatchObject({envelope: "inputs", key: "city", type: "string"})
    })

    it("groups an output-envelope variable separately", () => {
        const result = groupTemplateVariables(["$.outputs.score"])
        expect(result[0]).toMatchObject({envelope: "outputs", key: "score"})
    })

    it("collapses sub-path references into an object-typed group", () => {
        const result = groupTemplateVariables(["$.inputs.address.city", "$.inputs.address.country"])
        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
            envelope: "inputs",
            key: "address",
            type: "object",
        })
        expect(result[0].subPaths).toContain("city")
        expect(result[0].subPaths).toContain("country")
    })

    it("mixes simple and object variables without merging them", () => {
        const result = groupTemplateVariables(["name", "$.inputs.address.city"])
        const keys = result.map((r) => r.key)
        expect(keys).toContain("name")
        expect(keys).toContain("address")
    })

    it("deduplicates identical variables", () => {
        const result = groupTemplateVariables(["country", "country"])
        expect(result).toHaveLength(1)
    })

    it("ignores structurally malformed template variables", () => {
        // Post-mustache QA (Slack #release-v100, 2026-05-28): the validator
        // no longer flags near-typos of envelope slots — `$.input.x` is now
        // VALID and produces a testcase-spread group rooted at `inputs` with
        // key `input` and subPath `x`. Only structurally broken expressions
        // (empty placeholders, `$<not-dot>`, `$.` without a field, empty
        // segments) are filtered out by groupTemplateVariables.
        expect(groupTemplateVariables([""])).toHaveLength(0)
        expect(groupTemplateVariables(["$outputs.country"])).toHaveLength(0)
        expect(groupTemplateVariables(["$."])).toHaveLength(0)
        expect(groupTemplateVariables(["$..foo"])).toHaveLength(0)
    })

    it("treats near-typos of envelope slots as testcase-spread keys (no gating)", () => {
        // `$.input.x` is no longer treated as a typo of `$.inputs.x`. The
        // playground surfaces a variable named after the root segment
        // (`input`), the backend resolves the path at render time, and any
        // shape mismatch becomes a runtime error from the API — not a
        // pre-flight UI error.
        const result = groupTemplateVariables(["$.input.x"])
        expect(result).toHaveLength(1)
        expect(result[0].envelope).toBe("inputs")
        expect(result[0].key).toBe("input")
        expect(result[0].subPaths).toContain("x")
    })

    it("treats non-envelope JSONPath roots as testcase-spread inputs", () => {
        // RFC canonical: `{{$.profile.name}}` against a `profile` testcase
        // column. parseTemplateExpression routes the non-envelope first
        // segment under the `inputs` envelope, key = first segment.
        const result = groupTemplateVariables(["$.geo.region"])
        expect(result).toHaveLength(1)
        expect(result[0].envelope).toBe("inputs")
        expect(result[0].key).toBe("geo")
        expect(result[0].subPaths).toContain("region")
    })

    describe("templateFormat — plain dot-notation parsing", () => {
        // Background: backend curly does literal-key-first lookup
        // (sdks/python/agenta/sdk/utils/resolvers.py:46-50). A curly user
        // authoring `{{user.name}}` typically means a column LITERALLY named
        // `"user.name"`, and legacy curly testsets carry such dotted column
        // names. The other formats (mustache / jinja2) parse `{{user.name}}`
        // as nested by their spec.
        //
        // JSONPath and JSON Pointer paths stay nested regardless of format —
        // the backend treats `$.*` / `/*` identically across modes.

        it("curly: plain dotted names become literal single keys", () => {
            const result = groupTemplateVariables(["user.name"], {
                templateFormat: "curly",
            })
            expect(result).toHaveLength(1)
            expect(result[0]).toMatchObject({
                envelope: "inputs",
                key: "user.name",
                type: "string",
            })
            expect(result[0].subPaths).toBeUndefined()
        })

        it("curly: deep dotted names stay as a single literal key", () => {
            const result = groupTemplateVariables(["topic.story.title"], {
                templateFormat: "curly",
            })
            expect(result).toHaveLength(1)
            expect(result[0].key).toBe("topic.story.title")
            expect(result[0].subPaths).toBeUndefined()
        })

        it("curly: envelope-rooted dot paths still route through the envelope", () => {
            // `inputs.country` — first segment IS a known envelope slot, so
            // the literal-key fallback does NOT kick in. The envelope route
            // takes precedence so `inputs.country` and `$.inputs.country`
            // produce the same shape.
            const result = groupTemplateVariables(["inputs.country"], {
                templateFormat: "curly",
            })
            expect(result).toHaveLength(1)
            expect(result[0]).toMatchObject({
                envelope: "inputs",
                key: "country",
            })
        })

        it("curly: JSONPath placeholders still parse as nested", () => {
            // `$.user.name` is JSONPath — backend treats it identically across
            // formats per templating.py docstring. Stay nested.
            const result = groupTemplateVariables(["$.user.name"], {
                templateFormat: "curly",
            })
            expect(result).toHaveLength(1)
            expect(result[0].envelope).toBe("inputs")
            expect(result[0].key).toBe("user")
            expect(result[0].subPaths).toContain("name")
        })

        it("mustache: plain dotted names parse as nested (spec-conformant)", () => {
            const result = groupTemplateVariables(["user.name"], {
                templateFormat: "mustache",
            })
            expect(result).toHaveLength(1)
            expect(result[0]).toMatchObject({
                envelope: "inputs",
                key: "user",
                type: "object",
            })
            expect(result[0].subPaths).toContain("name")
        })

        it("jinja2: plain dotted names parse as nested (attribute/item access)", () => {
            const result = groupTemplateVariables(["user.name"], {
                templateFormat: "jinja2",
            })
            expect(result).toHaveLength(1)
            expect(result[0].key).toBe("user")
            expect(result[0].subPaths).toContain("name")
        })

        it("no format specified: defaults to nested (backward-compat)", () => {
            // Callers that don't pass templateFormat keep the pre-2026-05-28
            // behaviour: nested dot-notation. Important so older call sites
            // and tests don't silently flip semantics on us.
            const result = groupTemplateVariables(["user.name"])
            expect(result).toHaveLength(1)
            expect(result[0].key).toBe("user")
            expect(result[0].subPaths).toContain("name")
        })

        it("curly: deduplicates literal-key references across sub-paths", () => {
            // Two placeholders that both name the literal key `"user.name"`.
            // groupTemplateVariables should collapse to ONE port — same key
            // identity, no spurious sub-paths.
            const result = groupTemplateVariables(["user.name", "user.name"], {
                templateFormat: "curly",
            })
            expect(result).toHaveLength(1)
            expect(result[0].key).toBe("user.name")
            expect(result[0].subPaths).toBeUndefined()
        })

        it("curly: a mix of literal-dotted and plain names yields distinct ports", () => {
            // `country` → plain port; `user.name` → literal-key port. Two
            // distinct entries, no nesting between them.
            const result = groupTemplateVariables(["country", "user.name"], {
                templateFormat: "curly",
            })
            expect(result).toHaveLength(2)
            expect(result.map((g) => g.key).sort()).toEqual(["country", "user.name"])
        })
    })

    describe("sectionOpeners hint (mustache iteration intent)", () => {
        it("marks a section-opener-only name as `array`", () => {
            // `{{#languages}}{{.}}{{/languages}}` extracts `languages` as a
            // plain variable; the sectionOpeners hint tells the grouper it's
            // an iteration target → array type.
            const result = groupTemplateVariables(["languages"], {
                sectionOpeners: new Set(["languages"]),
            })
            expect(result).toHaveLength(1)
            expect(result[0]).toMatchObject({
                envelope: "inputs",
                key: "languages",
                type: "array",
            })
        })

        it("infers `array` for sub-pathed section openers (RFC Phase 2c)", () => {
            // `{{#repos}}{{name}}{{/repos}}` — `repos` is a section opener
            // and the inner `name` produces `repos.name` as a sub-path.
            // Mustache iterates an array of objects in this shape, so we
            // surface `array` as the type and keep the sub-paths to
            // describe the ROW (items) schema. Single-object templates
            // still render at runtime — mustache treats a non-array
            // truthy value as a one-element iteration.
            const result = groupTemplateVariables(["repos", "repos.name"], {
                sectionOpeners: new Set(["repos"]),
            })
            expect(result).toHaveLength(1)
            expect(result[0]).toMatchObject({
                envelope: "inputs",
                key: "repos",
                type: "array",
            })
            expect(result[0].subPaths).toContain("name")
        })

        it("infers `array` for nested section openers + records sectionSubPaths", () => {
            // `{{#org}}{{#users}}{{name}}{{/users}}{{/org}}` — both `org`
            // and `org.users` are section openers. `extractMustacheSection
            // Openers` emits DOTTED PATHS, so the hint is keyed by the
            // full path under the group (`org` for top-level, `org.users`
            // for nested).
            const result = groupTemplateVariables(["org", "org.users", "org.users.name"], {
                sectionOpeners: new Set(["org", "org.users"]),
            })
            const org = result.find((g) => g.key === "org")
            expect(org?.type).toBe("array")
            expect(org?.subPaths).toEqual(expect.arrayContaining(["users.name"]))
            // `users` is recorded as a nested section under `org` —
            // schema producer uses this to emit an array shape at that
            // depth instead of an object. Paths are RELATIVE to the
            // group root (so `"users"`, not `"org.users"`).
            expect(org?.sectionSubPaths).toContain("users")
        })

        it("records nested section paths at every depth", () => {
            // `{{#repos}}{{#contributors}}{{#tags}}{{name}}{{/tags}}…`
            // — three nested section levels.
            const result = groupTemplateVariables(
                [
                    "repos",
                    "repos.contributors",
                    "repos.contributors.tags",
                    "repos.contributors.tags.name",
                ],
                {
                    sectionOpeners: new Set([
                        "repos",
                        "repos.contributors",
                        "repos.contributors.tags",
                    ]),
                },
            )
            const repos = result.find((g) => g.key === "repos")
            expect(repos?.type).toBe("array")
            expect(repos?.sectionSubPaths).toEqual(
                expect.arrayContaining(["contributors", "contributors.tags"]),
            )
        })

        it("omits sectionSubPaths when there are no nested sections", () => {
            const result = groupTemplateVariables(["repos", "repos.name"], {
                sectionOpeners: new Set(["repos"]),
            })
            const repos = result.find((g) => g.key === "repos")
            expect(repos?.type).toBe("array")
            expect(repos?.sectionSubPaths).toBeUndefined()
        })

        it("infers `object` for sub-pathed NON-section names", () => {
            // `{{geo.region}}` — plain dotted reference, NOT a section
            // opener. Stays as `object` because there's no iteration
            // signal — just nested-field access.
            const result = groupTemplateVariables(["geo", "geo.region"])
            expect(result).toHaveLength(1)
            expect(result[0].type).toBe("object")
            expect(result[0].subPaths).toContain("region")
        })

        it("leaves non-opener names as `string`", () => {
            const result = groupTemplateVariables(["plain"], {
                sectionOpeners: new Set(["other"]),
            })
            expect(result[0].type).toBe("string")
        })

        it("is opt-in — no hint behaves exactly as before", () => {
            const result = groupTemplateVariables(["languages"])
            expect(result[0].type).toBe("string")
        })
    })
})

// ── extractInputPortsFromSchema ───────────────────────────────────────────────

describe("extractInputPortsFromSchema", () => {
    it("returns empty array for null or empty schema", () => {
        expect(extractInputPortsFromSchema(null)).toEqual([])
        expect(extractInputPortsFromSchema({})).toEqual([])
    })

    it("maps each schema property to a port", () => {
        const schema = {
            type: "object",
            properties: {
                country: {type: "string"},
                score: {type: "number"},
            },
        }
        const ports = extractInputPortsFromSchema(schema)
        expect(ports).toHaveLength(2)
        expect(ports.map((p) => p.key)).toEqual(expect.arrayContaining(["country", "score"]))
    })

    it("marks required fields", () => {
        const schema = {
            type: "object",
            properties: {country: {type: "string"}},
            required: ["country"],
        }
        const ports = extractInputPortsFromSchema(schema)
        expect(ports[0].required).toBe(true)
    })

    it("uses the schema title as the port name when present", () => {
        const schema = {
            type: "object",
            properties: {
                q: {type: "string", title: "Question"},
            },
        }
        const ports = extractInputPortsFromSchema(schema)
        expect(ports[0].name).toBe("Question")
    })

    it("falls back to formatKeyAsName when title is absent", () => {
        const schema = {
            type: "object",
            properties: {user_name: {type: "string"}},
        }
        const ports = extractInputPortsFromSchema(schema)
        expect(ports[0].name).toBe("User name")
    })

    it("filters out system fields annotated with x-ag-* markers", () => {
        const schema = {
            type: "object",
            properties: {
                country: {type: "string"},
                _context: {"x-ag-context": true, type: "string"},
            },
        }
        const ports = extractInputPortsFromSchema(schema)
        expect(ports).toHaveLength(1)
        expect(ports[0].key).toBe("country")
    })

    it("resolves $ref properties", () => {
        const schema = {
            type: "object",
            properties: {
                score: {$ref: "#/$defs/Score"},
            },
            $defs: {Score: {type: "integer"}},
        }
        const ports = extractInputPortsFromSchema(schema)
        expect(ports[0].type).toBe("integer")
    })
})

// ── extractOutputPortsFromSchema ──────────────────────────────────────────────

describe("extractOutputPortsFromSchema", () => {
    it("returns empty array for null input", () => {
        expect(extractOutputPortsFromSchema(null)).toEqual([])
    })

    it("returns a single 'output' port for a simple type schema", () => {
        const schema = {type: "string"}
        const ports = extractOutputPortsFromSchema(schema)
        expect(ports).toHaveLength(1)
        expect(ports[0]).toMatchObject({key: "output", type: "string"})
    })

    it("maps object schema properties to individual ports", () => {
        const schema = {
            type: "object",
            properties: {
                result: {type: "string"},
                confidence: {type: "number"},
            },
        }
        const ports = extractOutputPortsFromSchema(schema)
        expect(ports).toHaveLength(2)
        expect(ports.map((p) => p.key)).toEqual(expect.arrayContaining(["result", "confidence"]))
    })

    it("returns a single unknown port for an object schema without properties", () => {
        const schema = {type: "object"}
        const ports = extractOutputPortsFromSchema(schema)
        expect(ports).toHaveLength(1)
        expect(ports[0]).toMatchObject({key: "output", type: "unknown"})
    })
})

// ── extractSystemFieldNames ───────────────────────────────────────────────────

describe("extractSystemFieldNames", () => {
    it("returns an empty set for null input", () => {
        expect(extractSystemFieldNames(null).size).toBe(0)
    })

    it("returns an empty set when no properties are system fields", () => {
        const schema = {
            properties: {country: {type: "string"}},
        }
        expect(extractSystemFieldNames(schema).size).toBe(0)
    })

    it("identifies fields annotated with x-ag-* markers", () => {
        const schema = {
            properties: {
                country: {type: "string"},
                _ctx: {"x-ag-context": true},
                _consent: {"x-ag-consent": true},
            },
        }
        const names = extractSystemFieldNames(schema)
        expect(names.has("_ctx")).toBe(true)
        expect(names.has("_consent")).toBe(true)
        expect(names.has("country")).toBe(false)
    })
})
