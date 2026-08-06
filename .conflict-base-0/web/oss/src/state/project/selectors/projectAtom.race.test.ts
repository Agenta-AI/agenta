/**
 * Regression tests for two demo-workspace-banner flakiness bugs.
 *
 * --- Bug 1: URL pollution (Mahmoud's investigation, May 2026) ---
 *
 * On the root URL, /projects/ returns before the slower /organizations/{id}
 * fetch resolves. During that window, selectedOrgAtom is null, so the old
 * projectAtom computed workspaceId = null and pickPreferredProject fell
 * through to a cross-org `projects.find(p => p.is_default_project)`. For
 * users whose membership had is_demo = true on the Demo Workspace, that
 * cross-org search returned the Demo Workspace's default project. The URL
 * was then polluted via WorkspaceRedirect with /p/<demo-project>, and the
 * Layout banner rendered.
 *
 * Fix in projectAtom: fall back to selectedOrgIdAtom (URL-derived,
 * immediate) so workspaceId is always populated for the pick. This file
 * tests pickPreferredProject in isolation.
 *
 * --- Bug 2: Cold-reload banner-missing window ---
 *
 * On cold reload of /w/<demo>/p/<demoProject>, the demo-workspace banner
 * needs project?.is_demo, which depends on projectsQueryAtom firing.
 * Two issues stacked:
 *
 * a) Two parallel "session exists" atoms existed — @agenta/shared/state's
 *    sessionAtom (entity packages) and oss/state/session's sessionExistsAtom.
 *    appState/atoms.ts eagerly initialized the shared one on cold reload
 *    but not the oss one, so projectsQueryAtom (gated on the oss atom)
 *    stayed disabled until SessionListener's React effect fired.
 *
 * b) projectsQueryAtom.enabled also gated on profileQueryAtom.data.id,
 *    which forced /projects/ to wait for /profile/ to complete (sequential).
 *
 * Fix: consolidate to a single session atom by re-exporting the shared
 * sessionAtom as sessionExistsAtom from oss/state/session/atoms.ts (zero
 * call-site changes — same import path keeps working). Drop the redundant
 * profile.data.id gate in projectsQueryAtom.enabled. The existing eager
 * init of sessionAtom in appState/atoms.ts now unblocks all gated oss
 * queries at module load too, since they're reading the same atom.
 *
 * No unit test for this here — it's a hydration-ordering fix that needs
 * a full app render to verify. See state/session/atoms.ts (consolidation),
 * appState/atoms.ts:40-44 (eager init), and project.ts:projectsQueryAtom
 * comments for the mechanism.
 *
 * web/oss does not yet have vitest wired; this file documents the
 * regression and runs unmodified once vitest is added.
 */

import {describe, expect, it} from "vitest"

import type {ProjectsResponse} from "@/oss/services/project/types"

import {pickPreferredProject} from "./project"

const OWN_ORG_UUID = "019315dc-a341-7edb-bed4-114f0d50c91a"
const DEMO_ORG_UUID = "00000000-0000-0000-0000-00000000d3m0"
const OWN_PROJECT_ID = "00000000-0000-0000-0000-000000000001"
const DEMO_PROJECT_ID = "0193930d-83b6-7efa-a067-03056d548af4"

// Fixture mirrors the relevant rows of Mahmoud's /projects/ response from
// his investigation: the own-org "Default" project is_default_project=false,
// the Demo Workspace's "Default" is_default_project=true. This is what
// causes `projects.find(p => p.is_default_project)` (the cross-org fallback
// inside pickPreferredProject when workspaceId is null) to land on the
// demo project instead of an own-org one — the original bug.
const projects = [
    {
        organization_id: OWN_ORG_UUID,
        organization_name: "mahmoud-renamed",
        workspace_id: OWN_ORG_UUID,
        project_id: OWN_PROJECT_ID,
        project_name: "Default",
        is_default_project: false,
        is_demo: null,
        user_role: "owner",
    },
    {
        organization_id: DEMO_ORG_UUID,
        organization_name: "Demo Workspace",
        workspace_id: DEMO_ORG_UUID,
        project_id: DEMO_PROJECT_ID,
        project_name: "Default",
        is_default_project: true,
        is_demo: true,
        user_role: "viewer",
    },
] as unknown as ProjectsResponse[]

describe("pickPreferredProject", () => {
    it("documents the legacy bug: with workspaceId=null, falls through to the cross-org default and returns the demo project", () => {
        // This is the exact code path that the projectAtom fallback was hitting
        // before the fix. Kept here as a regression marker: if pickPreferredProject
        // is refactored to handle null workspaceId differently, update the
        // projectAtom fallback accordingly.
        const result = pickPreferredProject(projects, null, null)
        expect(result?.project_id).toBe(DEMO_PROJECT_ID)
        expect(result?.is_demo).toBe(true)
    })

    it("with workspaceId = own org UUID, scopes the pick to that org and returns the own project", () => {
        const result = pickPreferredProject(projects, OWN_ORG_UUID, null)
        expect(result?.project_id).toBe(OWN_PROJECT_ID)
        expect(result?.is_demo).not.toBe(true)
    })

    it("with workspaceId = demo org UUID, returns the demo project (still scoped, not cross-org)", () => {
        const result = pickPreferredProject(projects, DEMO_ORG_UUID, null)
        expect(result?.project_id).toBe(DEMO_PROJECT_ID)
        expect(result?.is_demo).toBe(true)
    })

    it("returns null when projects list is empty", () => {
        expect(pickPreferredProject([], OWN_ORG_UUID, null)).toBeNull()
    })
})
