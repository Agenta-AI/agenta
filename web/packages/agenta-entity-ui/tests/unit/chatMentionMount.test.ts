/**
 * Which drive a chat file mention opens in. The chat's markdown sanitizer hands every relative link
 * back with a leading slash (`agent-files/x` becomes `/agent-files/x`), so the resolver must read the
 * path as written before it looks for a sandbox root in it (#7715).
 */
import {describe, expect, it} from "vitest"

import {resolveMentionMount} from "../../src/drive/chatFileLookup"

const cwd = {id: "cwd"}
const agent = {id: "agent"}

describe("resolveMentionMount", () => {
    it("opens an agent-files link under a folder named `agenta-*` in the agent drive, whole", () => {
        for (const href of [
            "/agent-files/agenta-outreach-agent/library/persona.md",
            "agent-files/agenta-outreach-agent/library/persona.md",
        ]) {
            expect(resolveMentionMount(href, cwd, agent)).toEqual({
                mount: agent,
                path: "agenta-outreach-agent/library/persona.md",
            })
        }
        expect(
            resolveMentionMount("/agent-files/agenta-outreach-agent/README.md", cwd, agent),
        ).toEqual({mount: agent, path: "agenta-outreach-agent/README.md"})
    })

    it("opens a session link under a folder named `agenta-*` in the session drive, whole", () => {
        expect(resolveMentionMount("/linktest/agenta-demo/a.md", cwd, agent)).toEqual({
            mount: cwd,
            path: "linktest/agenta-demo/a.md",
        })
    })

    it("still strips the drive root from a full sandbox path", () => {
        expect(
            resolveMentionMount(
                "/var/lib/agenta/mounts/p/m/agent-files/agenta-outreach-agent/a.md",
                cwd,
                agent,
            ),
        ).toEqual({mount: agent, path: "agenta-outreach-agent/a.md"})
        expect(
            resolveMentionMount("/var/lib/agenta/mounts/p/m-agent/notes/a.md", cwd, agent),
        ).toEqual({mount: agent, path: "notes/a.md"})
        expect(resolveMentionMount("/var/lib/agenta/mounts/p/m/out/chart.png", cwd, agent)).toEqual(
            {
                mount: cwd,
                path: "out/chart.png",
            },
        )
    })

    it("falls back to the session drive when there is no agent drive", () => {
        expect(resolveMentionMount("/agent-files/a.md", cwd, null)).toEqual({
            mount: cwd,
            path: "agent-files/a.md",
        })
    })
})
