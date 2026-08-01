/**
 * Unit tests for `describeTool`'s built-in branch — the row label a tool shows in the Tools list.
 *
 * The branch was written for provider built-ins such as `{type: "web_search_preview"}`, where the
 * `type` IS the name. Pi built-ins persist as `{type: "builtin", name}`, so labelling from `type`
 * renders every one of them as "builtin" — four identical rows on any agent created from the
 * default template (issue #5590). Runs under @agenta/entity-ui's own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {describeTool} from "../../src/DrillInView/SchemaControls/agentTemplate/itemDescriptors"

describe("describeTool (built-in tools)", () => {
    it("labels a Pi built-in by its name, not by its type", () => {
        const descriptor = describeTool({type: "builtin", name: "read"})
        expect(descriptor.name).toBe("read")
        expect(descriptor.typeLabel).toBe("built-in")
        expect(descriptor.tags).toEqual(["built-in"])
    })

    it("labels each of Pi's default built-ins distinctly", () => {
        const names = ["read", "bash", "edit", "write"].map(
            (name) => describeTool({type: "builtin", name}).name,
        )
        expect(names).toEqual(["read", "bash", "edit", "write"])
    })

    it("falls back to the type for a provider built-in that carries no name", () => {
        expect(describeTool({type: "web_search_preview"}).name).toBe("web_search_preview")
    })

    it("falls back to the only key for a bare provider entry with no type", () => {
        expect(describeTool({code_interpreter: {}}).name).toBe("code_interpreter")
    })

    it("still describes a function tool by its function name", () => {
        const descriptor = describeTool({type: "function", function: {name: "get_weather"}})
        expect(descriptor.name).toBe("get_weather")
        expect(descriptor.typeLabel).toBe("definition")
    })
})
