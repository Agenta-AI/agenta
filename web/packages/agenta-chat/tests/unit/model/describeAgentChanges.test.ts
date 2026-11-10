/**
 * What a `create_agent` or `edit_agent_config` call SAYS, on the approval card and on the settled
 * row. Both write to an agent other than the one in this chat, so both must name that agent and
 * list the operations the way the `commit_revision` card lists them.
 */
import {describe, expect, it} from "vitest"

import {describeApproval} from "../../../src/model/approvalPreview"
import {
    describeCreateAgent,
    describeEditAgentConfig,
    summarizeAgentCall,
} from "../../../src/model/approvalDescribers/describeAgentChanges"
import {describeCommitRevision} from "../../../src/model/approvalDescribers/describeCommitRevision"
import {resolveActivityIcon, resolveToolDisplay} from "../../../src/skin/registry"

const operations = [
    {
        operation: "edit_text",
        target: ["parameters", "agent", "instructions", "agents_md"],
        edits: [{old_text: "a", new_text: "b"}],
    },
    {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: {name: "pdf-tools", description: "Makes PDFs"},
    },
]

describe("describeEditAgentConfig", () => {
    it("names the target and previews the operations like commit_revision", () => {
        const preview = describeEditAgentConfig({agent: "invoice-helper-k3x9", operations})
        const own = describeCommitRevision({workflow_revision: {delta: {operations}}}, undefined)

        expect(preview?.sentence).toContain("Save 2 changes to the agent invoice-helper-k3x9")
        expect(preview?.sentence).toContain("does not deploy it")
        expect(preview?.items).toEqual(own?.items)
    })

    it("falls back to the generic card when the call names no agent", () => {
        expect(describeEditAgentConfig({operations})).toBeNull()
    })

    it("is what the approval card uses, under any harness's wire name", () => {
        const preview = describeApproval({
            toolName: "mcp__agenta-tools__edit_agent_config",
            input: {agent: "invoice-helper-k3x9", operations},
        } as never)

        expect(preview.sentence).toContain("invoice-helper-k3x9")
        expect(preview.items.map((item) => item.title)).toEqual([
            "Edited instructions",
            "New skill · pdf-tools",
        ])
    })
})

describe("describeCreateAgent", () => {
    it("names the new agent, with or without operations", () => {
        expect(describeCreateAgent({name: "Invoice helper"})).toEqual({
            sentence: "Create the agent Invoice helper from the default setup.",
            items: [],
        })
        const preview = describeCreateAgent({name: "Invoice helper", operations})
        expect(preview?.sentence).toBe(
            "Create the agent Invoice helper from the default setup, with 2 changes.",
        )
        expect(preview?.items).toHaveLength(2)
    })
})

describe("the transcript row", () => {
    it("names the agent from the result once the call has run", () => {
        const output = JSON.stringify({agent: {id: "1", slug: "x", name: "Invoice helper"}})
        expect(summarizeAgentCall({agent: "x", operations}, output)).toBe(
            "Invoice helper: Edited instructions; New skill · pdf-tools",
        )
        expect(summarizeAgentCall({name: "Invoice helper"}, undefined)).toBe("Invoice helper")
    })

    it("says another agent, never 'the agent', which reads as this one", () => {
        const edit = resolveToolDisplay("edit_agent_config")
        expect(edit.activity.done).toBe("Saved changes to another agent")
        expect(resolveToolDisplay("read_agent_config").activity.done).toBe(
            "Read another agent's setup",
        )
        expect(resolveToolDisplay("create_agent").activity.done).toBe("Created an agent")
        expect(resolveToolDisplay("list_agents").activity.done).toBe("Checked agents")
        expect(resolveActivityIcon("platform", "list_agents")).toBe("agent")
        expect(resolveActivityIcon("platform", "edit_agent_config")).toBe("commit")
    })
})
