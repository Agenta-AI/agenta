/**
 * Unit tests for joining a bare GitHub repo name with its owner when the
 * event's schema wants `owner/repo`. Schemas are trimmed copies of Composio's.
 */

import {describe, expect, it} from "vitest"

import {normalizeRepoFilters} from "../../src/gatewayTrigger/core/repoFilter"

// GITHUB_PULL_REQUEST_CREATED: `repo` in owner/repo form, `owner` ignored once `repo` is set.
const ownerRepoSchema = {
    type: "object",
    properties: {
        owner: {
            type: "string",
            description:
                "Restrict the search to all repositories belonging to a GitHub user or organisation (e.g., 'facebook' or 'microsoft'). Ignored when 'repo' is also provided.",
        },
        repo: {
            type: "string",
            description:
                "Restrict the search to a specific repository. Must be in 'owner/repo' format (e.g., 'facebook/react'). Leave blank to search across all repositories accessible to the account.",
        },
    },
}

// GITHUB_ISSUE_CREATED_TRIGGER: `owner` plus a bare `repo` name.
const bareRepoSchema = {
    type: "object",
    required: ["owner", "repo"],
    properties: {
        owner: {type: "string", description: "The account owner of the repository."},
        repo: {
            type: "string",
            description: "The name of the repository without the .git extension.",
        },
    },
}

describe("normalizeRepoFilters", () => {
    it("joins a bare repo name with the owner when the schema wants owner/repo", () => {
        expect(normalizeRepoFilters(ownerRepoSchema, {owner: "agenta-ai", repo: "agenta"})).toEqual(
            {owner: "agenta-ai", repo: "agenta-ai/agenta"},
        )
    })

    it("trims both parts before joining", () => {
        expect(
            normalizeRepoFilters(ownerRepoSchema, {owner: " agenta-ai ", repo: " agenta "}),
        ).toEqual({owner: " agenta-ai ", repo: "agenta-ai/agenta"})
    })

    it("keeps a repo that is already in owner/repo form", () => {
        const values = {owner: "someone-else", repo: "agenta-ai/agenta"}
        expect(normalizeRepoFilters(ownerRepoSchema, values)).toBe(values)
    })

    it("leaves a bare repo name alone when there is no owner to join", () => {
        const values = {repo: "agenta"}
        expect(normalizeRepoFilters(ownerRepoSchema, values)).toBe(values)
    })

    it("leaves an empty repo empty", () => {
        const values = {owner: "agenta-ai", repo: ""}
        expect(normalizeRepoFilters(ownerRepoSchema, values)).toBe(values)
    })

    it("does not touch triggers that take owner and a bare repo name", () => {
        const values = {owner: "agenta-ai", repo: "agenta"}
        expect(normalizeRepoFilters(bareRepoSchema, values)).toBe(values)
    })

    it("does nothing without a schema", () => {
        const values = {owner: "agenta-ai", repo: "agenta"}
        expect(normalizeRepoFilters(null, values)).toBe(values)
    })
})
