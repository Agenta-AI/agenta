import type {ActivityStep} from "@agenta/chat/model"
import type {FileActivity} from "@agenta/entities/session"
import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {turnFiles} from "@/features/chat/turnFileList"

const part = {
    type: "tool-write",
    toolCallId: "c",
    state: "output-available",
    input: {},
    output: "",
} as ToolUIPart
const tool = (key: string, files: FileActivity[]): ActivityStep => ({
    kind: "tool",
    key,
    part,
    files,
})
const write = (path: string): FileActivity => ({op: "write", path, toolName: "write"})
const edit = (path: string): FileActivity => ({op: "edit", path, toolName: "edit"})

describe("turnFiles", () => {
    it("lists each path once, in the order the turn first touched it", () => {
        const steps = [
            tool("1", [write("b.md"), write("a.csv")]),
            {kind: "thought", key: "t", text: "hm", streaming: false, source: "text"} as const,
            tool("2", [edit("b.md"), write("c.py")]),
        ]
        expect(turnFiles(steps).map((file) => file.path)).toEqual(["b.md", "a.csv", "c.py"])
    })

    it("keeps a created file as created when a later step edits it", () => {
        expect(turnFiles([tool("1", [write("a.md")]), tool("2", [edit("a.md")])])).toEqual([
            {op: "write", path: "a.md", toolName: "write"},
        ])
    })

    it("takes the last op for a file the turn only edited", () => {
        const second: FileActivity = {op: "edit", path: "a.md", toolName: "str_replace"}
        expect(turnFiles([tool("1", [edit("a.md")]), tool("2", [second])])).toEqual([second])
    })

    it("is empty for a turn with no tool steps", () => {
        expect(turnFiles([])).toEqual([])
    })
})
