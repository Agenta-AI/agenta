/**
 * The change card data of a builder edit (tasks 8.2, 25.1, 25.2): old and new values come only
 * from the server preview; without a preview the card shows the proposed values and says so.
 * Each change has a title, a readable path, one of four detail forms, and its warning lines.
 */
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {groupChanges, removesOnly} from "../../../src/components/ChangeSections"
import {
    describeCreateAgent,
    describeEditAgentConfig,
    savedVersion,
    summarizeAgentCall,
} from "../../../src/model/approvalDescribers/describeAgentChanges"
import {describeConfigChanges} from "../../../src/model/approvalDescribers/describeChanges"
import {describeApproval} from "../../../src/model/approvalPreview"
import {getPendingApprovals} from "../../../src/model/approvals"
import recorded from "../fixtures/editAgentConfigTurn.json"

const message = recorded.message as unknown as UIMessage
const toolPart = recorded.message.parts[1] as {input: {operations: unknown[]}}
const operations = toolPart.input.operations

const T = ["parameters", "agent"]
const ZENDESK = {list: "tools", key: "gateway_connection:composio:zendesk"}
const GMAIL = {list: "tools", key: "gateway_connection:composio:gmail"}

/** A preview that applies, from its changes, on base v4. */
const applied = (changes: unknown[]) => ({
    applies: true,
    base: {id: "rev-4", version: "4"},
    operations: [{index: 0, applies: true}],
    changes,
})

describe("the gate of a recorded edit_agent_config part", () => {
    it("carries the server preview of its own tool call", () => {
        const [gate] = getPendingApprovals([message])
        expect(gate.toolName).toBe("edit_agent_config")
        expect(gate.changePreview).toEqual(recorded.message.parts[0].data?.preview)
    })

    it("has no preview when the part is missing (a reload)", () => {
        const reloaded = {...message, parts: message.parts.slice(1)} as UIMessage
        expect(getPendingApprovals([reloaded])[0].changePreview).toBeUndefined()
    })
})

describe("describeConfigChanges with a preview", () => {
    const [gate] = getPendingApprovals([message])
    const preview = describeApproval(gate)

    it("shows the old and the new value of each changed path", () => {
        expect(preview.proposedValues).toBe(false)
        expect(preview.changes).toHaveLength(3)
        const [instructions, model, skill] = preview.changes!
        expect(instructions.path).toEqual(["Instructions", "AGENTS.md"])
        expect(instructions.detail).toEqual({
            kind: "text_diff",
            old: "Answer invoice questions.\nBe kind.",
            new: "Answer invoice questions.\nBe short and kind.",
        })
        expect(model.detail).toEqual({
            kind: "value_change",
            label: "Model",
            old: "claude-sonnet-5-5",
            new: "claude-opus-5-5",
        })
        expect(skill.path).toEqual(["Skills"])
        expect(skill.detail).toEqual({
            kind: "item",
            change: "added",
            name: "refund-check",
            description: "Check refunds.",
            files: [{path: "SKILL.md"}],
        })
        expect(preview.changes!.every((change) => change.effect === "version")).toBe(true)
    })

    it("titles each change by what it does, and gives its section", () => {
        expect(preview.changes!.map((change) => [change.title, change.section])).toEqual([
            ["Edit the instructions", "instructions"],
            ["Change the model", "model"],
            ["Add a skill", "skills"],
        ])
    })

    it("names the base revision and its version, for Saves as v5", () => {
        expect(preview.base).toEqual({revisionId: "rev-4", version: 4})
        expect(preview.agentName).toBe("support-triage")
    })

    it("shows the value of a field that appears or goes away, not an item", () => {
        const {changes} = describeConfigChanges(operations, {
            applies: true,
            operations: [{index: 0, applies: true}],
            changes: [
                {
                    path: [...T, "llm", "reasoning"],
                    operation_indexes: [1],
                    kind: "added",
                    new: "medium",
                },
                {
                    path: [...T, "llm", "effort"],
                    operation_indexes: [1],
                    kind: "removed",
                    old: "low",
                },
            ],
        })
        expect(changes[0].detail).toEqual({kind: "value_change", label: "Reasoning", new: "medium"})
        expect(changes[1].detail).toEqual({kind: "value_change", label: "Reasoning", old: "low"})
    })

    it("keeps a change past the size bound as its title and path only", () => {
        const {changes} = describeConfigChanges(operations, {
            applies: true,
            operations: [{index: 0, applies: true}],
            changes: [
                {
                    path: [...T, "instructions", "agents_md"],
                    operation_indexes: [0],
                    kind: "changed",
                },
            ],
            truncated: true,
        })
        expect(changes[0].detail).toBeUndefined()
        expect(changes[0].title).toBe("Edit the instructions")
        expect(changes[0].path).toEqual(["Instructions", "AGENTS.md"])
    })
})

describe("the four detail forms, one per operation (the C01 cards)", () => {
    it("edits a skill file as a text diff under the skill's path", () => {
        const target = [...T, {list: "skills", key: "ticket-triage"}]
        const file = [...target, {list: "files", key: "references/urgency-rules.md"}, "content"]
        const {changes} = describeConfigChanges(
            [{operation: "edit_text", target: file, edits: [{old_text: "a", new_text: "b"}]}],
            applied([
                {
                    path: file,
                    operation_indexes: [0],
                    kind: "changed",
                    old: "| bug | medium |",
                    new: "| bug | medium, high from 3 reports |",
                },
            ]),
        )
        expect(changes[0].title).toBe("Edit a skill file")
        expect(changes[0].path).toEqual(["Skills", "ticket-triage", "references/urgency-rules.md"])
        expect(changes[0].detail).toEqual({
            kind: "text_diff",
            old: "| bug | medium |",
            new: "| bug | medium, high from 3 reports |",
        })
        expect(changes[0].risks).toEqual([])
    })

    it("shows a merged object as one value row per changed field, under one header", () => {
        const llm = [...T, "llm"]
        // The server keeps the merge's target: one change at `llm` with the old and new objects.
        const {changes} = describeConfigChanges(
            [
                {
                    operation: "merge",
                    target: llm,
                    value: {model: "claude-opus-5-5", reasoning: "medium"},
                },
            ],
            applied([
                {
                    path: llm,
                    operation_indexes: [0],
                    kind: "changed",
                    old: {provider: "anthropic", model: "claude-sonnet-5-5", reasoning: "low"},
                    new: {provider: "anthropic", model: "claude-opus-5-5", reasoning: "medium"},
                },
            ]),
        )
        expect(changes.map((change) => change.detail)).toEqual([
            {
                kind: "value_change",
                label: "Model",
                old: "claude-sonnet-5-5",
                new: "claude-opus-5-5",
            },
            {kind: "value_change", label: "Reasoning", old: "low", new: "medium"},
        ])
        const blocks = groupChanges(changes)
        expect(blocks).toHaveLength(1)
        expect(blocks[0]).toMatchObject({title: "Change the model", path: ["Model"]})
    })

    it("names the field of a long text in the path", () => {
        const description = [...T, {list: "skills", key: "refund-check"}, "description"]
        const {changes} = describeConfigChanges(
            [{operation: "set", target: description, value: "x".repeat(130)}],
            applied([
                {
                    path: description,
                    operation_indexes: [0],
                    kind: "changed",
                    old: "Checks refunds.",
                    new: "x".repeat(130),
                },
            ]),
        )
        expect(changes[0].path).toEqual(["Skills", "refund-check", "Description"])
        expect(changes[0].detail?.kind).toBe("text_diff")
    })

    it("shows a whole list that appears as its values, not as one item", () => {
        const {changes} = describeConfigChanges(
            [{operation: "set", target: [...T, "mcps"], value: [{name: "linear"}]}],
            applied([
                {
                    path: [...T, "mcps"],
                    operation_indexes: [0],
                    kind: "added",
                    new: [{name: "linear"}],
                },
            ]),
        )
        expect(changes[0].detail?.kind).not.toBe("item")
        expect(JSON.stringify(changes[0].detail)).toContain("linear")
        // The first server of a list that did not exist still sends data out.
        expect(changes[0].risks.map((risk) => risk.kind)).toEqual(["data_egress"])
        const builtin = describeConfigChanges([
            {
                operation: "set",
                target: [...T, "mcps"],
                value: [{name: "agenta", connection: {type: "gateway", namespace: "builtin"}}],
            },
        ])
        expect(builtin.changes[0].risks).toEqual([])
    })

    it("adds a skill with its description and files, and marks a file that can run", () => {
        const skill = {
            name: "refund-check",
            description: "Checks if a charge can be refunded",
            body: "# Refund check",
            files: [
                {path: "references/refund-policy.md", content: "..."},
                {path: "scripts/lookup_charge.py", content: "...", executable: true},
            ],
        }
        const {changes} = describeConfigChanges([
            {operation: "add_item", target: [...T, "skills"], value: skill},
        ])
        expect(changes[0]).toMatchObject({title: "Add a skill", path: ["Skills"]})
        expect(changes[0].detail).toEqual({
            kind: "item",
            change: "added",
            name: "refund-check",
            description: "Checks if a charge can be refunded",
            files: [
                {path: "SKILL.md"},
                {path: "references/refund-policy.md"},
                {path: "scripts/lookup_charge.py", executable: true},
            ],
        })
    })

    it("removes an integration: the item, and a main button that removes", () => {
        const {changes} = describeConfigChanges(
            [{operation: "remove_item", target: [...T, GMAIL]}],
            applied([
                {
                    path: [...T, GMAIL],
                    operation_indexes: [0],
                    kind: "removed",
                    old: {type: "gateway_connection", provider: "composio", integration: "gmail"},
                },
            ]),
        )
        expect(changes[0]).toMatchObject({
            title: "Remove an integration",
            path: ["Integrations"],
            section: "integrations",
            detail: {kind: "item", change: "removed", name: "Gmail"},
        })
        expect(removesOnly(changes)).toBe(true)
    })

    it("keeps the proposed value of each operation when the preview is missing", () => {
        const {changes, proposedValues} = describeConfigChanges([
            {operation: "set", target: [...T, "llm", "model"], value: "claude-opus-5-5"},
            {
                operation: "set",
                target: [...T, "instructions", "agents_md"],
                value: "Be short.",
            },
            {operation: "remove_item", target: [...T, {list: "skills", key: "old-skill"}]},
        ])
        expect(proposedValues).toBe(true)
        expect(changes[0].detail).toEqual({
            kind: "value_change",
            label: "Model",
            new: "claude-opus-5-5",
        })
        // Instructions are a text even when short: the card shows them as added lines.
        expect(changes[1].detail).toEqual({
            kind: "text_diff",
            new: "Be short.",
            fragmentsOnly: true,
        })
        expect(changes[2]).toMatchObject({
            title: "Remove a skill",
            detail: {kind: "item", change: "removed", name: "old-skill"},
        })
    })

    it("removes a skill file as that file, not as the skill", () => {
        const file = [
            ...T,
            {list: "skills", key: "release-qa"},
            {list: "files", key: "scripts/check.py"},
        ]
        const {changes} = describeConfigChanges([{operation: "remove_item", target: file}])
        expect(changes[0]).toMatchObject({
            title: "Remove a skill file",
            path: ["Skills", "release-qa", "scripts/check.py"],
            detail: {kind: "item", change: "removed", name: "scripts/check.py"},
        })
        const previewed = describeConfigChanges(
            [{operation: "remove_item", target: file}],
            applied([
                {
                    path: file,
                    operation_indexes: [0],
                    kind: "removed",
                    old: {path: "scripts/check.py", content: "print(1)"},
                },
            ]),
        )
        expect(previewed.changes[0].detail).toEqual({
            kind: "item",
            change: "removed",
            name: "scripts/check.py",
        })
    })

    it("shows an operation it cannot render as title and path only", () => {
        const {changes} = describeConfigChanges([
            {operation: "merge", target: [...T, "llm"], value: {a: 1}},
        ])
        expect(changes[0].detail).toBeUndefined()
        expect(changes[0]).toMatchObject({title: "Change the model", path: ["Model"]})
    })

    it("names a removed field when the preview is missing", () => {
        const {changes} = describeConfigChanges([
            {operation: "remove", target: [...T, "llm", "extras"]},
        ])
        expect(changes[0]).toMatchObject({
            title: "Change the model",
            path: ["Model"],
            detail: {kind: "item", change: "removed", name: "Extras"},
        })
    })

    it("titles a remove of a whole entry as a removal", () => {
        const {changes} = describeConfigChanges([
            {operation: "remove", target: [...T, {list: "mcps", key: "linear"}]},
        ])
        expect(changes[0]).toMatchObject({
            title: "Remove an MCP server",
            path: ["MCP servers"],
            detail: {kind: "item", change: "removed", name: "linear"},
        })
    })

    it("keeps the field in the path of a change with no detail", () => {
        const {changes} = describeConfigChanges([
            {operation: "merge", target: [...T, "harness", "permissions"], value: {a: 1}},
        ])
        expect(changes[0].detail).toBeUndefined()
        expect(changes[0].path).toEqual(["Permissions", "Harness › permissions"])
    })

    it("names an unknown setting by its path", () => {
        const {changes} = describeConfigChanges([
            {operation: "set", target: [...T, "harness", "max_iterations"], value: 40},
        ])
        expect(changes[0]).toMatchObject({title: "Change a setting", path: ["Settings"]})
        expect(changes[0].detail).toMatchObject({kind: "value_change", new: "40"})
    })
})

describe("warning lines from the operation (task 25.2)", () => {
    const closeTicket = [...T, ZENDESK, "policy", "permissions", "tools", "ZENDESK_CLOSE_TICKET"]
    const deleteTicket = [...T, ZENDESK, "policy", "permissions", "tools", "ZENDESK_DELETE_TICKET"]

    it("warns when a permission is set to Allow, and names the tool", () => {
        const {changes} = describeConfigChanges(
            [
                {operation: "set", target: closeTicket, value: "allow"},
                {operation: "set", target: deleteTicket, value: "deny"},
            ],
            applied([
                {
                    path: closeTicket,
                    operation_indexes: [0],
                    kind: "changed",
                    old: "ask",
                    new: "allow",
                },
                {
                    path: deleteTicket,
                    operation_indexes: [1],
                    kind: "changed",
                    old: "ask",
                    new: "deny",
                },
            ]),
        )
        expect(changes[0]).toMatchObject({
            title: "Change a tool permission",
            path: ["Integrations", "Zendesk"],
            detail: {kind: "value_change", label: "Close ticket", old: "Always ask", new: "Allow"},
            risks: [
                {
                    kind: "fewer_approvals",
                    message: "The agent will use Close ticket without asking you.",
                },
            ],
        })
        // Deny asks nothing less: no warning.
        expect(changes[1].risks).toEqual([])
        expect(changes[1].detail).toMatchObject({label: "Delete ticket", new: "Deny"})
        expect(groupChanges(changes)[0].risks).toHaveLength(1)
    })

    it("warns for a permission set to Allow when the preview is missing", () => {
        const {changes} = describeConfigChanges([
            {operation: "set", target: [...T, "runner", "permissions", "default"], value: "allow"},
        ])
        expect(changes[0].title).toBe("Change the permissions")
        expect(changes[0].risks).toEqual([
            {
                kind: "fewer_approvals",
                message: "The agent will use these tools without asking you.",
            },
        ])
    })

    it("does not warn when the permission was already Allow", () => {
        const {changes} = describeConfigChanges(
            [{operation: "set", target: closeTicket, value: "allow"}],
            applied([
                {
                    path: closeTicket,
                    operation_indexes: [0],
                    kind: "changed",
                    old: "allow",
                    new: "allow",
                },
            ]),
        )
        expect(changes[0].risks).toEqual([])
    })

    it("warns that data goes to an outside server for a new MCP server", () => {
        const server = {
            name: "linear",
            connection: {type: "http", url: "https://mcp.linear.app/sse"},
        }
        const {changes} = describeConfigChanges(
            [{operation: "add_item", target: [...T, "mcps"], value: server}],
            applied([
                {
                    path: [...T, {list: "mcps", key: "linear"}],
                    operation_indexes: [0],
                    kind: "added",
                    new: server,
                },
            ]),
        )
        expect(changes[0]).toMatchObject({
            title: "Add an MCP server",
            path: ["MCP servers"],
            detail: {kind: "item", change: "added", name: "linear", address: "mcp.linear.app/sse"},
            risks: [
                {kind: "data_egress", message: "Data from the agent will go to an outside server."},
            ],
        })
    })

    it("warns for a new MCP server URL, and for a new server when the preview is missing", () => {
        const url = [...T, {list: "mcps", key: "linear"}, "connection", "url"]
        expect(
            describeConfigChanges([{operation: "set", target: url, value: "https://x.dev/mcp"}])
                .changes[0].risks[0].kind,
        ).toBe("data_egress")
        expect(
            describeConfigChanges([
                {
                    operation: "add_item",
                    target: [...T, "mcps"],
                    value: {name: "x", connection: {type: "http", url: "https://x.dev"}},
                },
            ]).changes[0].risks[0].kind,
        ).toBe("data_egress")
    })

    it("shows no warning on other operations", () => {
        const [gate] = getPendingApprovals([message])
        const preview = describeApproval(gate)
        expect(preview.changes!.flatMap((change) => change.risks)).toEqual([])
        const builtin = describeConfigChanges([
            {
                operation: "add_item",
                target: [...T, "mcps"],
                value: {name: "agenta", connection: {type: "gateway", namespace: "builtin"}},
            },
        ])
        expect(builtin.changes[0].risks).toEqual([])
    })
})

describe("describeConfigChanges without a preview", () => {
    it("shows the proposed values with no old value, and never reads a revision", () => {
        const preview = describeEditAgentConfig(toolPart.input)!
        expect(preview.proposedValues).toBe(true)
        const [instructions, model, skill] = preview.changes!
        expect(instructions.detail).toEqual({
            kind: "text_diff",
            fragmentsOnly: true,
            edits: [{old: "Be kind.", new: "Be short and kind."}],
        })
        expect(model.detail).toEqual({kind: "value_change", label: "Model", new: "claude-opus-5-5"})
        expect(skill.detail).toMatchObject({kind: "item", change: "added", name: "refund-check"})
        // The base is the call's own revision id; the card reads its version.
        expect(preview.base).toEqual({revisionId: "rev-4"})
    })

    it("marks the operation a refused preview names, and shows no engine text", () => {
        const described = describeConfigChanges(recorded.failedOperations, recorded.failedPreview)
        expect(described.cannotApply).toBe(true)
        // The preview was computed, so the values are not "could not be loaded".
        expect(described.proposedValues).toBe(false)
        expect(described.changes[0].fails).toBe(true)
        expect(JSON.stringify(described)).not.toContain("does not occur")
    })

    it("drops preview entries that are not objects", () => {
        const described = describeConfigChanges(operations, {
            applies: false,
            operations: [null, {index: 1, applies: false}],
            changes: [null],
        })
        expect(described.cannotApply).toBe(true)
        expect(described.changes[1].fails).toBe(true)
    })

    it("keeps the refusal of a call with no operations", () => {
        const preview = describeEditAgentConfig(
            {agent: "x", operations: []},
            undefined,
            undefined,
            {
                applies: false,
                operations: [],
                changes: [],
                error: {code: "invalid_arguments", message: "no base"},
            },
        )
        expect(preview?.cannotApply).toBe(true)
        expect(preview?.changes).toEqual([])
    })

    it("treats a payload that is not a preview as no preview", () => {
        expect(describeConfigChanges(operations, {changes: "x"}).proposedValues).toBe(true)
    })
})

describe("create_agent", () => {
    it("has its own header with the agent's name, and the tool sentence", () => {
        const preview = describeCreateAgent(
            {name: "Refund helper", operations: []},
            undefined,
            undefined,
            {
                applies: true,
                operations: [],
                changes: [],
            },
        )!
        expect(preview.header).toEqual({title: "Create an agent", path: ["Refund helper"]})
        expect(preview.sentence).toBe(
            "Create the agent Refund helper from the default setup. Only you will see it.",
        )
        expect(preview.changes).toEqual([])
        expect(preview.base).toBeUndefined()
    })
})

describe("the result row", () => {
    it("says which version the save made", () => {
        expect(savedVersion(recorded.committedOutput)).toBe("5")
        expect(summarizeAgentCall(toolPart.input, recorded.committedOutput)).toMatch(
            /^Saved as v5 · Support triage: /,
        )
    })

    it("says no version for a result that did not save", () => {
        expect(savedVersion({status: "conflict"})).toBeNull()
        expect(savedVersion(JSON.stringify(recorded.committedOutput))).toBe("5")
    })
})
