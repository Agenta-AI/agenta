import type {ActivityStep} from "@agenta/chat/model"
import type {FileActivity} from "@agenta/entities/session"
import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {answerLinkedPaths, turnFiles} from "@/features/chat/turnFileList"

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

    it("shows a created file as deleted when a later step deletes it", () => {
        const removed: FileActivity = {op: "delete", path: "a.md", toolName: "bash"}
        expect(turnFiles([tool("1", [write("a.md")]), tool("2", [removed])])).toEqual([removed])
    })

    it("takes the last op for a file the turn only edited", () => {
        const second: FileActivity = {op: "edit", path: "a.md", toolName: "str_replace"}
        expect(turnFiles([tool("1", [edit("a.md")]), tool("2", [second])])).toEqual([second])
    })

    it("is empty for a turn with no tool steps", () => {
        expect(turnFiles([])).toEqual([])
    })

    it("adds a file the answer links to that no step wrote, such as a zip a shell built", () => {
        const answer = "Saved.\n\n- **Zip:** [shorts-1.0.0.zip](templates/shorts-1.0.0.zip)"
        expect(turnFiles([tool("1", [write("notes.md")])], [answer])).toEqual([
            {op: "write", path: "notes.md", toolName: "write"},
            {op: "link", path: "templates/shorts-1.0.0.zip"},
        ])
    })

    it("does not add a linked file a step already wrote under its sandbox path", () => {
        const written = write("/var/lib/agenta/mounts/s/m/report.md")
        expect(turnFiles([tool("1", [written])], ["See [report](./report.md)."])).toEqual([written])
    })

    it("matches a link into agent-files to a write under the agent mount", () => {
        const written = write("/var/lib/agenta/mounts/s/m-agent/plan.md")
        expect(turnFiles([tool("1", [written])], ["[plan](agent-files/plan.md)"])).toEqual([
            written,
        ])
    })

    it("keeps a linked file that only shares a name with a written one", () => {
        const written = write("/var/lib/agenta/mounts/s/m/notes/report.md")
        expect(turnFiles([tool("1", [written])], ["[report](report.md)"])).toEqual([
            written,
            {op: "link", path: "report.md"},
        ])
    })
})

describe("turnFiles linked dedupe", () => {
    it("adds one card for two links that name the same drive file", () => {
        const answer = "[zip](foo.zip) and [same zip](/var/lib/agenta/mounts/s/m/foo.zip)"
        expect(turnFiles([], [answer])).toEqual([{op: "link", path: "foo.zip"}])
    })

    it("drops a link to an absolute path outside the drive", () => {
        expect(turnFiles([], ["[hosts](/etc/hosts.txt)"])).toEqual([])
    })
})

describe("answerLinkedPaths", () => {
    it("keeps relative file links once each, in order", () => {
        expect(
            answerLinkedPaths([
                "[a](./out/a.zip) and [b](b%20c.md) and [a again](out/a.zip#top)",
                "[deep](/var/lib/agenta/mounts/s/m/x.csv)",
            ]),
        ).toEqual(["out/a.zip", "b c.md", "/var/lib/agenta/mounts/s/m/x.csv"])
    })

    it("keeps spaces in a target written inside angle brackets", () => {
        expect(answerLinkedPaths(["[zip](<launch kit.zip>)"])).toEqual(["launch kit.zip"])
    })

    it("keeps parentheses in a file name", () => {
        expect(answerLinkedPaths(['[zip](out/a(1).zip) and [b](<b.zip> "title")'])).toEqual([
            "out/a(1).zip",
            "b.zip",
        ])
    })

    it("skips web links, images, folders, parent paths and links shown as code", () => {
        expect(
            answerLinkedPaths([
                "[site](https://agenta.ai/x.zip) [host](//evil.com/x.zip) [top](#intro)",
                "![chart](chart.png) [folder](templates/) [up](../secret.md)",
                "`[code](a.zip)`\n```\n[block](b.zip)\n```",
            ]),
        ).toEqual([])
    })
})
