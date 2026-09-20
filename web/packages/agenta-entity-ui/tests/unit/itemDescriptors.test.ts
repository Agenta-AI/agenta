/**
 * Unit tests for `describeTool`'s built-in branch — the row label a tool shows in the Tools list —
 * and for `isHarnessBuiltinTool`, the predicate that keeps legacy harness built-ins out of the
 * list entirely.
 *
 * The branch serves provider built-ins such as `{type: "web_search_preview"}`, where the `type` IS
 * the name. Harness built-ins (`{type: "builtin", name}`) are always active and are no longer
 * configured, so the list filters them out before describing anything. Runs under
 * @agenta/entity-ui's own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {
    describeTool,
    skillCommandName,
} from "../../src/DrillInView/SchemaControls/agentTemplate/itemDescriptors"
import {isHarnessBuiltinTool} from "../../src/DrillInView/SchemaControls/toolUtils"

describe("isHarnessBuiltinTool", () => {
    it("matches a legacy harness built-in entry", () => {
        expect(isHarnessBuiltinTool({type: "builtin", name: "read"})).toBe(true)
    })

    it("does not match a provider built-in", () => {
        expect(isHarnessBuiltinTool({type: "web_search_preview"})).toBe(false)
    })

    it("does not match a function tool, a bare provider entry, or a non-object", () => {
        expect(isHarnessBuiltinTool({type: "function", function: {name: "get_weather"}})).toBe(
            false,
        )
        expect(isHarnessBuiltinTool({code_interpreter: {}})).toBe(false)
        expect(isHarnessBuiltinTool(null)).toBe(false)
        expect(isHarnessBuiltinTool("read")).toBe(false)
    })
})

describe("describeTool (built-in tools)", () => {
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

describe("skillCommandName", () => {
    const embed = (refs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
        "@ag.embed": {"@ag.references": refs, "@ag.selector": {path: "parameters.skill"}},
        ...extra,
    })

    it("uses a registry skill's name, not its suffixed slug", () => {
        const skill = embed({workflow: {slug: "skill-name-23ad", id: "wf"}}, {name: "skill-name"})
        expect(skillCommandName(skill)).toBe("skill-name")
    })

    it("uses the name for a pinned registry skill too", () => {
        const skill = embed(
            {workflow_revision: {slug: "skill-name-23ad", version: "3"}},
            {name: "skill-name"},
        )
        expect(skillCommandName(skill)).toBe("skill-name")
    })

    it("falls back to the slug when the embed has no usable name", () => {
        expect(skillCommandName(embed({workflow: {slug: "skill-name-23ad"}}))).toBe(
            "skill-name-23ad",
        )
        expect(
            skillCommandName(embed({workflow: {slug: "skill-name-23ad"}}, {name: "Skill Name"})),
        ).toBe("skill-name-23ad")
    })

    it("gives a nameless built-in skill no command", () => {
        expect(
            skillCommandName(embed({workflow: {slug: "__ag__getting_started_with_agenta"}})),
        ).toBeUndefined()
        expect(
            skillCommandName(embed({workflow: {slug: "_agenta.agenta-getting-started"}})),
        ).toBeUndefined()
    })

    it("keeps a named built-in skill", () => {
        const skill = embed({workflow: {slug: "__ag__build_an_agent"}}, {name: "build-an-agent"})
        expect(skillCommandName(skill)).toBe("build-an-agent")
    })

    it("uses an inline skill's name", () => {
        expect(skillCommandName({name: "weather", description: "d", body: "b"})).toBe("weather")
        expect(skillCommandName({name: "not valid"})).toBeUndefined()
        expect(skillCommandName(null)).toBeUndefined()
    })
})
