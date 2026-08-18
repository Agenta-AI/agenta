import {
    appMatchesType,
    selectLatestAppRevisions,
} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
import type {
    APP_TYPE,
    ListAppsItem,
} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers/types"
import {expect, test} from "@playwright/test"

const app = (flags: ListAppsItem["flags"]): ListAppsItem =>
    ({
        id: "app-id",
        name: "test-app",
        app_type: "completion",
        flags,
        created_at: null,
    }) as ListAppsItem

test("agent revisions are excluded from prompt app matching", () => {
    const artifact = app({is_application: true})
    const agentRevision = {
        flags: {is_agent: true, is_chat: true, is_custom: true},
    }

    for (const type of ["completion", "chat", "custom"] satisfies APP_TYPE[]) {
        expect(appMatchesType(artifact, type, agentRevision)).toBe(false)
    }
})

test("latest revision flags classify prompt apps", () => {
    const artifact = app({is_application: true})

    expect(appMatchesType(artifact, "completion", {flags: {}})).toBe(true)
    expect(appMatchesType(artifact, "chat", {flags: {is_chat: true}})).toBe(true)
    expect(appMatchesType(artifact, "custom", {flags: {is_custom: true}})).toBe(true)
})

test("latest revision selection ignores v0 records", () => {
    const latestByAppId = selectLatestAppRevisions([
        {
            workflow_id: "app-id",
            flags: {is_agent: true},
            version: "0",
            created_at: "2026-07-31T10:00:00Z",
        },
        {
            workflow_id: "app-id",
            flags: {},
            version: "1",
            created_at: "2026-07-31T09:00:00Z",
        },
    ])

    const latest = latestByAppId.get("app-id")
    expect(latest?.version).toBe("1")
    expect(appMatchesType(app({is_application: true}), "completion", latest)).toBe(true)
})

test("latest revision selection keeps records with a missing version", () => {
    const latestByAppId = selectLatestAppRevisions([
        {
            workflow_id: "app-id",
            flags: {is_agent: true},
            created_at: "2026-07-31T09:00:00Z",
        },
        {
            workflow_id: "app-id",
            flags: {},
            version: "0",
            created_at: "2026-07-31T10:00:00Z",
        },
    ])

    const latest = latestByAppId.get("app-id")
    expect(latest?.version).toBeUndefined()
    expect(latest?.flags?.is_agent).toBe(true)
})
