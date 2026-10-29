/**
 * What a `commit_revision` gate SAYS on the card.
 *
 * The card shows no payload and no diff, so these assertions are the only thing standing between a
 * user and a wall of JSON: every verb must produce a row a non-technical reader can act on, and an
 * unreadable value must degrade to an honest description rather than a guess.
 */
import {describe, expect, it} from "vitest"

import {describeCommitRevision} from "../../../src/model/approvalDescribers/describeCommitRevision"

const commit = (delta: unknown) => ({workflow_revision: {message: "wip", delta}})
const ordered = (...operations: unknown[]) => commit({operations})

describe("describeCommitRevision", () => {
    it("names a new skill and explains it in the skill's own words", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "add_item",
                target: ["parameters", "agent", "skills"],
                value: {
                    name: "deslope",
                    description: "Softens statements that read as too intense",
                },
            }),
            undefined,
        )

        expect(preview?.items).toEqual([
            {
                title: "New skill · deslope",
                detail: "Softens statements that read as too intense.",
            },
        ])
        expect(preview?.sentence).toContain("Save 1 change to this agent")
        expect(preview?.sentence).toContain("nothing is overwritten")
    })

    it("says what a gateway tool does, from its action and integration", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "add_item",
                target: ["parameters", "agent", "tools"],
                value: {
                    name: "search_github_issues",
                    type: "gateway",
                    provider: "composio",
                    integration: "github",
                    action: "SEARCH_ISSUES_AND_PULL_REQUESTS",
                },
            }),
            undefined,
        )

        expect(preview?.items[0]).toEqual({
            title: "New tool · search_github_issues",
            detail: "Searches issues and pull requests on Github.",
        })
    })

    it("keeps a selector key with a space intact rather than truncating it", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "remove_item",
                target: ["parameters", "agent", {list: "skills", key: "legacy search"}],
            }),
            undefined,
        )

        expect(preview?.items[0]).toEqual({
            title: "Skill removed \u00b7 legacy search",
            detail: "No longer available to the agent.",
        })
    })

    it("says a removed skill is gone rather than showing the selector", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "remove_item",
                target: ["parameters", "agent", {list: "skills", key: "legacy-search"}],
            }),
            undefined,
        )

        expect(preview?.items[0]).toEqual({
            title: "Skill removed · legacy-search",
            detail: "No longer available to the agent.",
        })
    })

    it("names the field without its sub-path, and counts edits instead of rendering them", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "edit_text",
                target: ["parameters", "agent", "instructions", "agents_md"],
                edits: [
                    {old: "warmly", new: "briefly"},
                    {old: "a", new: "b"},
                ],
            }),
            undefined,
        )

        expect(preview?.items[0]).toEqual({
            title: "Edited instructions",
            detail: "2 edits to the existing text.",
        })
    })

    it("collapses a literal set to one line but keeps the full text for expansion", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "set",
                target: ["parameters", "agent", "instructions"],
                value: `line one\nline two ${"x".repeat(400)}`,
            }),
            undefined,
        )

        expect(preview?.items[0].title).toBe("New instructions")
        // Whitespace collapses so the collapsed row is one line, but nothing under the safety cap
        // is truncated — the expand affordance must be able to show the whole change.
        expect(preview?.items[0].detail).not.toContain("\n")
        expect(preview?.items[0].detail?.endsWith("…")).toBe(false)
        expect(preview?.items[0].detail?.length).toBeGreaterThan(400)
    })

    it("clamps only a pathologically long value at the safety cap", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "set",
                target: ["parameters", "agent", "instructions"],
                value: "y".repeat(5000),
            }),
            undefined,
        )

        expect(preview?.items[0].detail?.endsWith("…")).toBe(true)
        expect(preview?.items[0].detail?.length).toBeLessThan(5000)
    })

    it("falls back to the verb and a preview for a value it cannot read as prose", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "future_verb",
                target: ["parameters", "agent", "model"],
                value: {provider: "anthropic"},
            }),
            undefined,
        )

        expect(preview?.items[0].title).toBe("future_verb model")
        expect(preview?.items[0].detail).toContain("anthropic")
    })

    it("points at the workspace rather than printing bytes it cannot show", () => {
        const preview = describeCommitRevision(
            ordered({
                operation: "set",
                target: ["parameters", "agent", "instructions"],
                value: {"@ag.file": "instructions.md"},
            }),
            {
                files: [{relativePath: "instructions.md", bytes: 900, digest: "abc123"}],
                diffs: [{targetField: "instructions", addedLines: 4, removedLines: 1}],
            },
        )

        const titles = preview?.items.map((item) => item.title)
        expect(titles).toContain("Rewrote instructions")
        expect(titles).toContain("From your workspace · instructions.md")
        // The manifest owns this change, so the file-backed op must NOT be listed a second time.
        expect(titles).not.toContain("Replace instructions")
        expect(preview?.items).toHaveLength(2)
        expect(preview?.sentence).toContain("Save 2 changes")
        // No digest, no byte count, anywhere in the copy.
        expect(JSON.stringify(preview)).not.toContain("abc123")
        expect(JSON.stringify(preview)).not.toContain("900")
    })

    it("describes a legacy {set, remove} delta from its key paths", () => {
        const preview = describeCommitRevision(
            commit({
                set: {parameters: {agent: {instructions: "Be brief."}}},
                remove: [["parameters", "agent", "tools"]],
            }),
            undefined,
        )

        const titles = preview?.items.map((item) => item.title)
        expect(titles).toContain("Changed instructions")
        expect(titles).toContain("Removed tools")
    })

    it("returns null when there is nothing readable, so the generic describer runs", () => {
        expect(describeCommitRevision({}, undefined)).toBeNull()
        expect(describeCommitRevision(commit({operations: []}), undefined)).toBeNull()
    })
})
