import {describe, expect, it} from "vitest"

import {resolveOutputSchemaProperties} from "../../src/workflow/core/schema"

// Auto-created feedback evaluators (POST /simple/traces/ and /annotations/) infer their
// output schema with genson over the full trace `data` envelope ({outputs: {...}}), so the
// stored outputs schema is wrapped one level deeper than UI-created evaluators. The filter
// and annotation display read the real metric keys via resolveOutputSchemaProperties, so it
// must unwrap that envelope while leaving every other evaluator untouched.
describe("resolveOutputSchemaProperties envelope unwrap", () => {
    it("unwraps the genson-inferred {outputs:{properties}} envelope", () => {
        const data = {
            schemas: {
                outputs: {
                    type: "object",
                    properties: {
                        outputs: {
                            type: "object",
                            properties: {
                                score: {type: "integer"},
                                comment: {type: "string"},
                            },
                        },
                    },
                },
            },
        }

        expect(resolveOutputSchemaProperties(data)).toEqual({
            score: {type: "integer"},
            comment: {type: "string"},
        })
    })

    it("leaves a flat (UI-created) output schema unchanged", () => {
        const data = {
            schemas: {
                outputs: {
                    type: "object",
                    properties: {
                        score: {type: "number"},
                        sentiment: {type: "string", enum: ["low", "high"]},
                    },
                },
            },
        }

        expect(resolveOutputSchemaProperties(data)).toEqual({
            score: {type: "number"},
            sentiment: {type: "string", enum: ["low", "high"]},
        })
    })

    it("does not unwrap a real single metric literally named `outputs`", () => {
        // A leaf metric named `outputs` has no nested `properties`, so it must survive.
        const data = {
            schemas: {
                outputs: {
                    type: "object",
                    properties: {
                        outputs: {type: "number"},
                    },
                },
            },
        }

        expect(resolveOutputSchemaProperties(data)).toEqual({
            outputs: {type: "number"},
        })
    })

    it("keeps an `outputs` envelope that has no inner properties", () => {
        const data = {
            schemas: {
                outputs: {
                    type: "object",
                    properties: {
                        outputs: {type: "object"},
                    },
                },
            },
        }

        expect(resolveOutputSchemaProperties(data)).toEqual({
            outputs: {type: "object"},
        })
    })

    it("does not unwrap when `outputs` is one of several keys", () => {
        const data = {
            schemas: {
                outputs: {
                    type: "object",
                    properties: {
                        outputs: {type: "object", properties: {x: {type: "number"}}},
                        score: {type: "number"},
                    },
                },
            },
        }

        expect(resolveOutputSchemaProperties(data)).toEqual({
            outputs: {type: "object", properties: {x: {type: "number"}}},
            score: {type: "number"},
        })
    })

    it("returns null when there is no output schema", () => {
        expect(resolveOutputSchemaProperties({schemas: {outputs: {type: "object"}}})).toBeNull()
        expect(resolveOutputSchemaProperties(null)).toBeNull()
    })
})
