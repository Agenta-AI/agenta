/**
 * Unit tests for filterOutDemoProjects, the projectsAtom demo-project filter.
 *
 * Demo projects (project.is_demo) are hidden from the UI entirely, unless
 * every project the user can see is a demo one — hiding them there would
 * leave an empty, dead-end project UI. Belt-and-suspenders with the
 * demo-org filter in state/org/selectors/org.ts (demo projects live in
 * demo orgs, which orgsAtom already hides).
 */

import {describe, expect, it} from "vitest"

import type {ProjectsResponse} from "@/oss/services/project/types"

import {filterOutDemoProjects} from "./project"

const ownProject = {
    organization_id: "019315dc-a341-7edb-bed4-114f0d50c91a",
    workspace_id: "019315dc-a341-7edb-bed4-114f0d50c91a",
    project_id: "00000000-0000-0000-0000-000000000001",
    project_name: "Default",
    is_default_project: true,
    is_demo: null,
    user_role: "owner",
} as unknown as ProjectsResponse

const demoProject = {
    organization_id: "00000000-0000-0000-0000-00000000d3m0",
    workspace_id: "00000000-0000-0000-0000-00000000d3m0",
    project_id: "0193930d-83b6-7efa-a067-03056d548af4",
    project_name: "Default",
    is_default_project: false,
    is_demo: true,
    user_role: "viewer",
} as unknown as ProjectsResponse

describe("filterOutDemoProjects", () => {
    it("filters demo projects out when a non-demo project exists", () => {
        const result = filterOutDemoProjects([ownProject, demoProject])
        expect(result).toEqual([ownProject])
    })

    it("keeps demo projects when they are all the user has", () => {
        const result = filterOutDemoProjects([demoProject])
        expect(result).toEqual([demoProject])
    })

    it("treats is_demo=null as non-demo", () => {
        const result = filterOutDemoProjects([ownProject])
        expect(result).toEqual([ownProject])
    })

    it("returns an empty list unchanged", () => {
        expect(filterOutDemoProjects([])).toEqual([])
    })
})
