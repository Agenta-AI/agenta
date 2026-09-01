/**
 * What a path SAYS on the approval card.
 *
 * A `read` gate fell through to the generic preview, which rendered the payload verbatim — so the
 * card asked for a trust decision on a 200-character sandbox path whose every meaningful segment
 * was buried behind two mount UUIDs and a 64-char skill hash (#6349). The card is read by people
 * who do not know what `/tmp/agenta/mounts/<uuid>/<uuid>/` is, and should not have to.
 */
import {describe, expect, it} from "vitest"

import {displayPath, fileTarget} from "../../../src/model/approvalDescribers/approvalText"
import {describeApproval} from "../../../src/model/approvalPreview"

const SKILL_PATH =
    "/tmp/agenta/mounts/01a03952-d243-7890-aafa-8f1c6a42672a/01a05cbc-51a5-7e73-a13e-8e70968b136b" +
    "/agents/skills/5eee78b5924e4761f63041f9ca2e406cd3c198319a3b06f5bdc5f56efec594e9" +
    "/build-an-agent/SKILL.md"

const gate = (toolName: string, input: unknown) => ({toolName, input, manifest: undefined}) as never

describe("displayPath", () => {
    it("drops the sandbox root and the runner's id segments", () => {
        expect(displayPath(SKILL_PATH)).toBe("agents/skills/…/build-an-agent/SKILL.md")
    })

    it("leaves a path that is already relative alone", () => {
        expect(displayPath("notes/meeting.md")).toBe("notes/meeting.md")
    })

    it("keeps a folder a person named, digits and all", () => {
        expect(displayPath("/tmp/agenta/mounts/p1/m1/2024-reports/q3-v2/summary.md")).toBe(
            "2024-reports/q3-v2/summary.md",
        )
    })

    it("collapses a run of ids into one gap", () => {
        const uuid = "01a03952-d243-7890-aafa-8f1c6a42672a"
        expect(displayPath(`/tmp/agenta/mounts/p1/m1/agents/sessions/${uuid}/${uuid}/log.md`)).toBe(
            "agents/sessions/…/log.md",
        )
    })

    it("shows a path outside the sandbox verbatim, because that is the point of asking", () => {
        expect(displayPath("/etc/hosts")).toBe("/etc/hosts")
    })
})

describe("fileTarget", () => {
    it("names a file by its folder and its name", () => {
        expect(fileTarget(SKILL_PATH)).toBe("build-an-agent/SKILL.md")
    })

    it("is just the name when the file sits at the root", () => {
        expect(fileTarget("README.md")).toBe("README.md")
    })

    it("keeps every segment of a path outside the workspace", () => {
        // Naming it ".ssh/id_rsa" would word a file the agent reached OUTSIDE its sandbox exactly
        // like one of the project's own — on the line a person actually reads.
        expect(fileTarget("/home/me/.ssh/id_rsa")).toBe("/home/me/.ssh/id_rsa")
        expect(fileTarget("/etc/hosts")).toBe("/etc/hosts")
    })

    it("drops a parent that elided to a gap — the name alone says more", () => {
        expect(
            fileTarget("/tmp/agenta/mounts/p1/m1/agents/skills/" + "a".repeat(40) + "/x.md"),
        ).toBe("x.md")
    })
})

describe("the generic preview for a file gate", () => {
    it("names the file in the sentence instead of saying 'a file'", () => {
        const preview = describeApproval(gate("read", {path: SKILL_PATH}))

        expect(preview.sentence).toBe(
            "The agent wants your approval before reading build-an-agent/SKILL.md.",
        )
    })

    it("shows the readable path on the row, never the raw one", () => {
        const preview = describeApproval(gate("read", {path: SKILL_PATH}))

        expect(preview.items).toEqual([
            {title: "Path", detail: "agents/skills/…/build-an-agent/SKILL.md"},
        ])
    })

    it("leaves a many-file tool alone, whose path is the scope and not the target", () => {
        // "looking for src/" would claim glob is after that path rather than searching under it.
        expect(describeApproval(gate("glob", {path: "src/deep"})).sentence).toBe(
            "The agent wants your approval before looking for files.",
        )
        expect(describeApproval(gate("ls", {path: "notes"})).sentence).toBe(
            "The agent wants your approval before listing files.",
        )
    })

    it("names an edit and a write too, not only a read", () => {
        expect(describeApproval(gate("write", {file_path: "notes/todo.md"})).sentence).toBe(
            "The agent wants your approval before writing notes/todo.md.",
        )
    })

    it("falls back to the generic wording when the gate names no path", () => {
        expect(describeApproval(gate("read", {})).sentence).toBe(
            "The agent wants your approval before reading a file.",
        )
    })

    it("does not soften a read outside the workspace in the sentence either", () => {
        expect(describeApproval(gate("read", {path: "/home/me/.ssh/id_rsa"})).sentence).toBe(
            "The agent wants your approval before reading /home/me/.ssh/id_rsa.",
        )
    })

    it("leaves a gateway argument's path alone — it addresses someone else's storage", () => {
        // `/agenta/mounts/...` in a Dropbox argument is a real remote path, not this sandbox's root.
        const preview = describeApproval(
            gate("run_tool", {
                integration: "dropbox",
                tool: "UPLOAD_FILE",
                arguments: {path: "/agenta/mounts/team/2024/report.pdf"},
            }),
        )

        expect(preview.items.map((item) => item.detail)).toContain(
            "/agenta/mounts/team/2024/report.pdf",
        )
    })

    it("leaves a non-file gate's sentence alone", () => {
        expect(describeApproval(gate("bash", {command: "ls"})).sentence).toBe(
            "The agent wants your approval before running a command.",
        )
    })
})
