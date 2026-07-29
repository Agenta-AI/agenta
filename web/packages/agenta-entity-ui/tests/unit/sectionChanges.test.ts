/**
 * Pins the CONTRACT between the commit-diff classifier and the config panel/drawer.
 *
 * The drawer marks a changed property by hardcoding its dot-path on a `RailField`
 * (`path="harness.permissions.allow"`), and sub-sections open via `hasChangedUnder("harness")`.
 * Those strings only work if they match what `classifyAgentChanges` actually flattens to — and a
 * mismatch fails SILENTLY (no mark, no error), so it must be asserted rather than assumed.
 *
 * These tests therefore diff realistic before/after templates the same way the panel does (bare
 * agent template on both sides) and assert the emitted `scalarChanges` keys verbatim.
 */
import {classifyAgentChanges} from "@agenta/entities/workflow/commitDiff"
import {describe, expect, it} from "vitest"

import {
    revertPathsTo,
    SECTION_ID_TO_PANEL_KEY,
    toSectionChanges,
} from "../../src/DrillInView/SchemaControls/agentTemplate/sectionChanges"

/** The bare agent template both sides of the panel's diff use (`parameters.agent`, unwrapped). */
const template = (overrides: Record<string, unknown> = {}) => ({
    instructions: {agents_md: "You are a friendly hello-world agent."},
    llm: {model: "gpt-5", provider: "openai"},
    tools: [],
    harness: {kind: "claude"},
    runner: {permissions: {default: "allow_reads"}},
    sandbox: {kind: "local"},
    ...overrides,
})

const changesFor = (local: Record<string, unknown>, remote: Record<string, unknown>) =>
    toSectionChanges(classifyAgentChanges(local, remote))

describe("SECTION_ID_TO_PANEL_KEY", () => {
    it("maps every classifier section id to a panel key", () => {
        expect(SECTION_ID_TO_PANEL_KEY).toEqual({
            model: "model-harness",
            instructions: "instructions",
            tools: "tools",
            mcps: "mcp",
            skills: "skills",
            params: "advanced",
        })
    })
})

describe("changed paths — the strings the drawer hardcodes", () => {
    it("an approval grant to harness.permissions.allow lands on the Advanced section at that exact path", () => {
        const committed = template()
        const draft = template({harness: {kind: "claude", permissions: {allow: ["Terminal"]}}})
        const changes = changesFor(draft, committed)

        expect(changes.panelKeys.has("advanced")).toBe(true)
        expect(changes.changedPaths.has("harness.permissions.allow")).toBe(true)
        expect(changes.isChanged("harness.permissions.allow")).toBe(true)
    })

    // The row's popover answers "changed from what?" with `before` — so a change the classifier
    // reports MUST also be retrievable by its path, or the row marks itself and then has nothing to
    // say. `before: undefined` is meaningful (the commit didn't set it) and must survive as itself.
    it("recalls what a changed property was committed as, by path", () => {
        const changes = changesFor(
            template({runner: {permissions: {default: "allow"}}}),
            template({runner: {permissions: {default: "ask"}}}),
        )

        expect(changes.changeFor("runner.permissions.default")?.before).toBe("ask")
        expect(changes.changeFor("runner.permissions.default")?.after).toBe("allow")
        expect(changes.changeFor("sandbox.kind")).toBeUndefined()
    })

    it("reports a property the commit never had as added, with no before value", () => {
        const changes = changesFor(
            template({harness: {kind: "claude", permissions: {allow: ["Terminal"]}}}),
            template(),
        )
        const change = changes.changeFor("harness.permissions.allow")

        expect(change).toBeDefined()
        expect(change?.before).toBeUndefined()
    })

    it("opens the Permissions group (harness/runner) but not Execution environment (sandbox)", () => {
        const committed = template()
        const draft = template({harness: {kind: "claude", permissions: {allow: ["Terminal"]}}})
        const changes = changesFor(draft, committed)

        expect(changes.hasChangedUnder("harness")).toBe(true)
        expect(changes.hasChangedUnder("runner")).toBe(false)
        expect(changes.hasChangedUnder("sandbox")).toBe(false)
    })

    it("emits runner.permissions.default for a Policy change", () => {
        const committed = template()
        const draft = template({runner: {permissions: {default: "allow"}}})
        const changes = changesFor(draft, committed)

        expect(changes.changedPaths.has("runner.permissions.default")).toBe(true)
        expect(changes.hasChangedUnder("runner")).toBe(true)
    })

    it("emits sandbox.kind and the nested sandbox.permissions.* paths", () => {
        const committed = template()
        const draft = template({
            sandbox: {
                kind: "daytona",
                permissions: {network: {mode: "off"}, filesystem: "readonly"},
            },
        })
        const changes = changesFor(draft, committed)

        expect(changes.changedPaths.has("sandbox.kind")).toBe(true)
        expect(changes.changedPaths.has("sandbox.permissions.network.mode")).toBe(true)
        expect(changes.changedPaths.has("sandbox.permissions.filesystem")).toBe(true)
        expect(changes.hasChangedUnder("sandbox")).toBe(true)
    })

    it("keeps harness.kind on Model & harness, NOT Advanced (the buckets are split there)", () => {
        const committed = template()
        const draft = template({harness: {kind: "pi_core"}})
        const changes = changesFor(draft, committed)

        expect(changes.panelKeys.has("model-harness")).toBe(true)
        expect(changes.panelKeys.has("advanced")).toBe(false)
        expect(changes.changedPaths.has("harness.kind")).toBe(true)
    })

    it("reports nothing changed for an identical template", () => {
        const changes = changesFor(template(), template())
        expect(changes.panelKeys.size).toBe(0)
        expect(changes.changedPaths.size).toBe(0)
        expect(changes.hasChangedUnder("harness")).toBe(false)
    })
})

describe("revertPathsTo", () => {
    it("restores a changed value to the committed one, and the diff then reports clean", () => {
        const committed = template()
        const draft = template({runner: {permissions: {default: "allow"}}})

        const reverted = revertPathsTo(draft, committed, ["runner.permissions.default"])

        expect(reverted).toEqual(committed)
        expect(changesFor(reverted, committed).changedPaths.size).toBe(0)
    })

    it("DELETES a key the commit never had (an added property), pruning the empty slice it leaves", () => {
        const committed = template() // harness: {kind: "claude"} — no `permissions`
        const draft = template({harness: {kind: "claude", permissions: {allow: ["Terminal"]}}})

        const reverted = revertPathsTo(draft, committed, ["harness.permissions.allow"])

        // Not `permissions: {}` left behind — the slice is pruned, so the diff is truly clean.
        expect(reverted.harness).toEqual({kind: "claude"})
        expect(changesFor(reverted, committed).changedPaths.size).toBe(0)
    })

    it("reverts only the named path, leaving other changes intact (key-scoped undo)", () => {
        const committed = template()
        const draft = template({
            harness: {kind: "claude", permissions: {allow: ["Terminal"]}},
            runner: {permissions: {default: "allow"}},
        })

        const reverted = revertPathsTo(draft, committed, ["harness.permissions.allow"])
        const changes = changesFor(reverted, committed)

        expect(changes.changedPaths.has("harness.permissions.allow")).toBe(false)
        expect(changes.changedPaths.has("runner.permissions.default")).toBe(true)
    })

    it("reverts a whole subtree from pathsUnder (section-scoped undo)", () => {
        const committed = template()
        const draft = template({
            sandbox: {kind: "daytona", permissions: {filesystem: "readonly"}},
        })
        const paths = changesFor(draft, committed).pathsUnder("sandbox")

        const reverted = revertPathsTo(draft, committed, paths)

        expect(reverted).toEqual(committed)
    })

    it("restores an array leaf whole, and never mutates the input", () => {
        const committed = template({harness: {kind: "claude", permissions: {allow: ["Read"]}}})
        const draft = template({
            harness: {kind: "claude", permissions: {allow: ["Read", "Terminal"]}},
        })
        const snapshot = JSON.stringify(draft)

        const reverted = revertPathsTo(draft, committed, ["harness.permissions.allow"]) as {
            harness: {permissions: {allow: string[]}}
        }

        expect(reverted.harness.permissions.allow).toEqual(["Read"])
        expect(JSON.stringify(draft)).toBe(snapshot)
    })

    it("is a no-op without a committed baseline (a never-saved draft has nothing to revert to)", () => {
        const draft = template()
        expect(revertPathsTo(draft, null, ["runner.permissions.default"])).toBe(draft)
    })
})

describe("hasChangedUnder", () => {
    it("matches the subtree, not a same-prefixed sibling key", () => {
        const changes = toSectionChanges([
            {
                id: "params",
                title: "Advanced",
                tags: [],
                totalCount: 1,
                scalarChanges: [
                    {key: "harnessing.thing", before: "a", after: "b", kind: "changed"},
                ],
            },
        ])
        // "harnessing.thing" must NOT make the `harness` group look changed.
        expect(changes.hasChangedUnder("harness")).toBe(false)
        expect(changes.hasChangedUnder("harnessing")).toBe(true)
    })

    it("treats an exact path as changed under itself", () => {
        const changes = toSectionChanges([
            {
                id: "params",
                title: "Advanced",
                tags: [],
                totalCount: 1,
                scalarChanges: [{key: "harness", before: "a", after: "b", kind: "changed"}],
            },
        ])
        expect(changes.hasChangedUnder("harness")).toBe(true)
    })
})
