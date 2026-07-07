/**
 * Unit tests for filterOutDemoOrgs, the orgsAtom demo-org filter.
 *
 * Demo orgs (org.flags.is_demo) are hidden from the UI entirely, unless
 * they are the user's only orgs (e.g. allowlisted users without
 * org-creation rights whose only memberships are demo ones) — hiding
 * them there would leave an empty, dead-end workspace UI.
 */

import {describe, expect, it} from "vitest"

import type {Org} from "@/oss/lib/Types"

import {filterOutDemoOrgs} from "./org"

const ownOrg = {
    id: "019315dc-a341-7edb-bed4-114f0d50c91a",
    name: "mahmoud-renamed",
    owner_id: "user-1",
    flags: {},
} as unknown as Org

const demoOrg = {
    id: "00000000-0000-0000-0000-00000000d3m0",
    name: "Demo Workspace",
    owner_id: "someone-else",
    flags: {is_demo: true},
} as unknown as Org

const secondDemoOrg = {
    id: "00000000-0000-0000-0000-00000000d3m1",
    name: "Demo Workspace 2",
    owner_id: "someone-else",
    flags: {is_demo: true},
} as unknown as Org

describe("filterOutDemoOrgs", () => {
    it("filters demo orgs out when the user has at least one non-demo org", () => {
        const result = filterOutDemoOrgs([ownOrg, demoOrg])
        expect(result).toEqual([ownOrg])
    })

    it("keeps demo orgs when they are the user's only orgs", () => {
        const result = filterOutDemoOrgs([demoOrg, secondDemoOrg])
        expect(result).toEqual([demoOrg, secondDemoOrg])
    })

    it("returns non-demo orgs unchanged", () => {
        const result = filterOutDemoOrgs([ownOrg])
        expect(result).toEqual([ownOrg])
    })

    it("returns an empty list unchanged", () => {
        expect(filterOutDemoOrgs([])).toEqual([])
    })
})
