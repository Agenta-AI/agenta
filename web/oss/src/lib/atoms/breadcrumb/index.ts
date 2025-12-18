import {atom} from "jotai"

import {appsAtom} from "@/oss/state/app"
import {appStateSnapshotAtom} from "@/oss/state/appState"
import {selectedOrgAtom} from "@/oss/state/org"
import {projectsAtom} from "@/oss/state/project"

import {buildBreadcrumbSegments} from "../../helpers/buildBreadcrumbs"

import type {BreadcrumbAtom} from "./types"

const breadcrumbOverridesAtom = atom<BreadcrumbAtom>({})

export const defaultBreadcrumbAtom = atom<BreadcrumbAtom>((get) => {
    const appState = get(appStateSnapshotAtom)
    const apps = get(appsAtom)
    const selectedOrg = get(selectedOrgAtom)
    const projects = get(projectsAtom)
    const projectId = appState.projectId
    const project = projectId ? projects.find((p) => p.project_id === projectId) || null : null

    return buildBreadcrumbSegments({
        uriPath: appState.asPath || appState.pathname,
        apps,
        workspaceId: appState.workspaceId ?? selectedOrg?.id ?? null,
        workspaceName: selectedOrg?.name ?? "",
        projectId,
        projectName: project?.project_name ?? null,
        projectIsPending: !!projectId && !project,
    })
})

export const breadcrumbAtom = atom<BreadcrumbAtom>((get) => {
    const base = get(defaultBreadcrumbAtom)
    const overrides = get(breadcrumbOverridesAtom)
    if (!overrides) return base
    const keys = Object.keys(overrides)
    if (!keys.length) return base
    return {...base, ...overrides}
})

// Helper atom to set breadcrumbs
export const setBreadcrumbsAtom = atom(null, (get, set, breadcrumbs: BreadcrumbAtom | null) => {
    set(breadcrumbOverridesAtom, breadcrumbs ?? {})
})

// Helper atom to append a breadcrumb item
export const appendBreadcrumbAtom = atom(null, (get, set, item: BreadcrumbAtom) => {
    const current = get(breadcrumbOverridesAtom) || {}
    set(breadcrumbOverridesAtom, {...current, ...item})
})

// Helper atom to prepend a breadcrumb item
export const prependBreadcrumbAtom = atom(null, (get, set, item: BreadcrumbAtom) => {
    const current = get(breadcrumbOverridesAtom) || {}
    set(breadcrumbOverridesAtom, {...item, ...current})
})

export const removeBreadcrumbsAtom = atom(null, (get, set, keys: string[] | undefined) => {
    if (!keys || keys.length === 0) return

    const current = get(breadcrumbOverridesAtom) || {}
    let changed = false
    const next = {...current}

    keys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(next, key)) {
            delete next[key]
            changed = true
        }
    })

    if (changed) {
        set(breadcrumbOverridesAtom, next)
    }
})

// Helper atom to clear breadcrumbs (reset to URL-based)
export const clearBreadcrumbsAtom = atom(null, (get, set) => {
    set(breadcrumbOverridesAtom, {})
})

export type {BreadcrumbAtom, BreadcrumbItem} from "./types"
