/**
 * Unit tests for the deployment "last modified" date resolution.
 *
 * Regression guard for the bug where the Deployment card showed the environment record's
 * own timestamp (which never changes on deploy) instead of the deployed revision's date.
 *
 * The helper encodes the precedence
 * revision.created_at > revision.updated_at > env.updated_at > env.created_at. A revision
 * is an immutable commit whose `created_at` is the commit/deploy moment, so it wins over
 * both the revision's own `updated_at` (NULL on commit) and the env artifact's timestamps.
 */

import {describe, it, expect} from "vitest"

import {resolveDeploymentLastModified} from "../../src/environment/state/appDeployments"

describe("resolveDeploymentLastModified", () => {
    it("uses the deployed revision's commit date over the environment timestamp", () => {
        const env = {created_at: "2025-08-18T06:16:49Z", updated_at: "2025-08-18T06:16:49Z"}
        const revision = {created_at: "2025-08-25T13:16:00Z", updated_at: null}
        expect(resolveDeploymentLastModified(revision, env)).toBe("2025-08-25T13:16:00Z")
    })

    it("prefers the revision's created_at over its updated_at", () => {
        const env = {created_at: "2025-08-18T06:16:49Z", updated_at: "2025-08-18T06:16:49Z"}
        const revision = {created_at: "2025-08-25T13:16:00Z", updated_at: "2025-08-30T09:00:00Z"}
        expect(resolveDeploymentLastModified(revision, env)).toBe("2025-08-25T13:16:00Z")
    })

    it("falls back to the revision's updated_at when created_at is missing", () => {
        const env = {created_at: "2025-08-18T06:16:49Z", updated_at: "2025-08-18T06:16:49Z"}
        const revision = {created_at: null, updated_at: "2025-08-30T09:00:00Z"}
        expect(resolveDeploymentLastModified(revision, env)).toBe("2025-08-30T09:00:00Z")
    })

    it("falls back to env.updated_at when the revision is unavailable", () => {
        const env = {created_at: "2025-08-18T06:16:49Z", updated_at: "2025-09-01T10:00:00Z"}
        expect(resolveDeploymentLastModified(null, env)).toBe("2025-09-01T10:00:00Z")
        expect(resolveDeploymentLastModified(undefined, env)).toBe("2025-09-01T10:00:00Z")
        expect(resolveDeploymentLastModified({created_at: null, updated_at: null}, env)).toBe(
            "2025-09-01T10:00:00Z",
        )
    })

    it("falls back to env.created_at when revision date and env.updated_at are missing", () => {
        const env = {created_at: "2025-08-18T06:16:49Z", updated_at: null}
        expect(resolveDeploymentLastModified(null, env)).toBe("2025-08-18T06:16:49Z")
    })

    it("returns null when no date is available", () => {
        expect(resolveDeploymentLastModified(null, {created_at: null, updated_at: null})).toBeNull()
    })
})
