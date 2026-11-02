import {describe, expect, it} from "vitest"

import {buildAppDeploymentHistory} from "../../src/environment/core/appDeploymentHistory"
import type {EnvironmentRevision} from "../../src/environment/core"
import {pickModelName} from "../../src/workflow/core/pickModelName"

const APP = {id: "app-1", slug: "alpha"}

const ref = (appId: string | null, revisionId: string, appSlug: string | null = null) => ({
    application: {id: appId, slug: appSlug},
    application_variant: {id: `variant-${revisionId}`, slug: `alpha.v-${revisionId}`},
    application_revision: {id: revisionId, version: "3"},
})

const envRevision = (
    id: string,
    version: number,
    refs: Record<string, ReturnType<typeof ref>>,
): EnvironmentRevision => ({
    id,
    version,
    environment_id: "env-1",
    message: `note ${id}`,
    author: "user-1",
    created_at: "2025-01-01T00:00:00Z",
    data: {references: refs},
})

describe("buildAppDeploymentHistory", () => {
    it("Deployment history keeps only revisions that reference the app", () => {
        const rows = buildAppDeploymentHistory(
            [
                envRevision("e3", 3, {a: ref("app-1", "r2")}),
                envRevision("e2", 2, {b: ref("app-2", "r9")}),
            ],
            APP,
        )
        expect(rows.map((row) => row.envRevisionId)).toEqual(["e3"])
    })

    it("Deployment history drops the empty first revision", () => {
        const rows = buildAppDeploymentHistory([envRevision("e1", 0, {a: ref("app-1", "r1")})], APP)
        expect(rows).toEqual([])
    })

    it("Consecutive deployments of the same app revision collapse into one", () => {
        const rows = buildAppDeploymentHistory(
            [
                envRevision("e4", 4, {a: ref("app-1", "r2"), b: ref("app-2", "x2")}),
                envRevision("e3", 3, {a: ref("app-1", "r2"), b: ref("app-2", "x1")}),
                envRevision("e2", 2, {a: ref("app-1", "r1")}),
            ],
            APP,
        )
        expect(rows.map((row) => row.envRevisionId)).toEqual(["e3", "e2"])
    })

    it("The newest deployment gets the highest index", () => {
        const rows = buildAppDeploymentHistory(
            [
                envRevision("e3", 3, {a: ref("app-1", "r3")}),
                envRevision("e2", 2, {a: ref("app-1", "r2")}),
                envRevision("e1", 1, {a: ref("app-1", "r1")}),
            ],
            APP,
        )
        expect(rows.map((row) => row.index)).toEqual([3, 2, 1])
    })

    it("An app matched by slug gets its deployed revision id", () => {
        const rows = buildAppDeploymentHistory(
            [envRevision("e2", 2, {a: ref(null, "r7", "alpha")})],
            APP,
        )
        expect(rows[0]).toMatchObject({deployedRevisionId: "r7", deployedRevisionVersion: 3})
    })
})

describe("pickModelName", () => {
    it("Model name comes only from model keys, not from prompt text", () => {
        expect(
            pickModelName({
                prompt: {messages: [{content: "model: not this"}], llm_config: {model: " gpt-x "}},
            }),
        ).toBe("gpt-x")
        expect(pickModelName({prompt: {messages: [{content: "model"}]}})).toBe("")
        expect(pickModelName(null)).toBe("")
    })
})
