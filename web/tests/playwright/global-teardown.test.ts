import assert from "node:assert/strict"
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {afterEach, describe, it} from "node:test"

import {deleteEphemeralProject} from "./global-teardown.ts"

const roots: string[] = []

function fixture(metadata: Record<string, unknown>) {
    const root = mkdtempSync(join(tmpdir(), "agenta-global-teardown-"))
    roots.push(root)
    const projectPath = join(root, "test-project.json")
    const statePath = join(root, "state.json")
    writeFileSync(projectPath, JSON.stringify(metadata))
    writeFileSync(
        statePath,
        JSON.stringify({cookies: [{name: "sAccessToken", value: "test-session"}]}),
    )
    return {projectPath, statePath}
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("deleteEphemeralProject", () => {
    it("never deletes a fallback or default project", async () => {
        const paths = fixture({
            project_id: "persistent-project",
            workspace_id: "workspace",
            ephemeral: false,
        })
        let requestCount = 0

        await deleteEphemeralProject("https://example.test/api", {
            ...paths,
            fetchFn: async () => {
                requestCount += 1
                return new Response(null, {status: 204})
            },
        })

        assert.equal(requestCount, 0)
        assert.equal(existsSync(paths.projectPath), false)
    })

    it("deletes an owned ephemeral project and removes its metadata", async () => {
        const paths = fixture({
            project_id: "ephemeral-project",
            project_name: "e2e-test",
            workspace_id: "workspace",
            ephemeral: true,
        })
        const requests: Array<{url: string; method?: string}> = []

        await deleteEphemeralProject("https://example.test/api", {
            ...paths,
            fetchFn: async (input, init) => {
                requests.push({url: String(input), method: init?.method})
                return new Response(null, {status: 204})
            },
        })

        assert.deepEqual(requests, [
            {
                url: "https://example.test/api/projects/ephemeral-project",
                method: "DELETE",
            },
        ])
        assert.equal(existsSync(paths.projectPath), false)
    })

    it("retains owned-project metadata when deletion fails", async () => {
        const metadata = {
            project_id: "ephemeral-project",
            project_name: "e2e-test",
            workspace_id: "workspace",
            ephemeral: true,
        }
        const paths = fixture(metadata)

        await deleteEphemeralProject("https://example.test/api", {
            ...paths,
            fetchFn: async () => new Response("temporary failure", {status: 503}),
        })

        assert.equal(existsSync(paths.projectPath), true)
        assert.deepEqual(JSON.parse(readFileSync(paths.projectPath, "utf8")), metadata)
    })
})
