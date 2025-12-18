import {getDefaultStore} from "jotai"
import {selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"

import {previewEvalTypeAtom} from "@/oss/components/EvalRunDetails2/state/evalType"
import {lastVisitedEvaluationAtom} from "@/oss/components/pages/evaluations/state/lastVisitedEvaluationAtom"
import type {AppStateSnapshot, RouteLayer} from "@/oss/state/appState"
import {appStateSnapshotAtom} from "@/oss/state/appState"
import {selectedOrgAtom} from "@/oss/state/org/selectors/org"

import {recentAppIdAtom} from "../app"
import type {UserOnboardingStatus} from "../onboarding/types"

import {resolveOnboardingSection} from "./resolveURLSection"

export interface URLState {
    appId: string
    workspaceId: string
    workspaceName: string
    projectId: string | null
    baseOrgURL: string
    orgURL: string
    baseProjectURL: string
    projectURL: string
    baseAppURL: string
    recentlyVisitedAppURL: string
    appURL: string
}

export type URLLocationScope =
    | "root"
    | "auth"
    | "post-signup"
    | "workspace"
    | "project"
    | "app"
    | "public"
    | "unknown"

interface BaseURLLocationState {
    scope: URLLocationScope
    routeLayer: RouteLayer
    section: string | null
    subsection: string | null
    trail: string
    key: string
}

export interface URLLocationState extends BaseURLLocationState {
    resolvedSection: keyof UserOnboardingStatus | null
}

const createLocationState = (
    scope: URLLocationScope,
    routeLayer: RouteLayer,
    section: string | null,
    subsection: string | null,
    trail: string,
): BaseURLLocationState => {
    const normalizedSection = section ?? null
    const normalizedSubsection = subsection ?? null
    const normalizedTrail = trail || ""
    const keyParts = [scope]

    if (normalizedSection) {
        keyParts.push(normalizedSection)
    }
    if (normalizedSubsection) {
        keyParts.push(normalizedSubsection)
    }
    if (
        normalizedTrail &&
        normalizedTrail !== normalizedSection &&
        normalizedTrail !== normalizedSubsection
    ) {
        keyParts.push(normalizedTrail)
    }

    return {
        scope,
        routeLayer,
        section: normalizedSection,
        subsection: normalizedSubsection,
        trail: normalizedTrail,
        key: keyParts.join("|"),
    }
}

const resolveLocationFromSnapshot = (snapshot: AppStateSnapshot): BaseURLLocationState => {
    const {segments, restPath, routeLayer} = snapshot
    const [first, second] = segments

    if (segments.length === 0) {
        return createLocationState("root", routeLayer, null, null, "")
    }

    if (first === "auth") {
        const authRest = segments.slice(1)
        return createLocationState(
            "auth",
            routeLayer,
            authRest[0] ?? null,
            authRest[1] ?? null,
            authRest.join("/"),
        )
    }

    if (first === "post-signup") {
        const postSignupRest = segments.slice(1)
        return createLocationState(
            "post-signup",
            routeLayer,
            postSignupRest[0] ?? null,
            postSignupRest[1] ?? null,
            postSignupRest.join("/"),
        )
    }

    if (first === "workspaces" && second === "accept") {
        const acceptRest = segments.slice(2)
        return createLocationState(
            "auth",
            routeLayer,
            "workspaces-accept",
            acceptRest[0] ?? null,
            acceptRest.join("/"),
        )
    }

    if (first === "w") {
        if (segments.length === 1) {
            return createLocationState("workspace", routeLayer, null, null, "")
        }

        if (routeLayer === "app") {
            const section = restPath[0] ?? null
            return createLocationState(
                "app",
                routeLayer,
                section,
                restPath[1] ?? null,
                restPath.join("/"),
            )
        }
        if (routeLayer === "project") {
            const projectSegments = restPath.length > 0 ? restPath : segments.slice(4)
            return createLocationState(
                "project",
                routeLayer,
                projectSegments[0] ?? null,
                projectSegments[1] ?? null,
                projectSegments.join("/"),
            )
        }
        if (routeLayer === "workspace" || routeLayer === "root") {
            return createLocationState(
                "workspace",
                routeLayer,
                restPath[0] ?? null,
                restPath[1] ?? null,
                restPath.join("/"),
            )
        }

        if (routeLayer === "unknown") {
            const workspaceRest = segments.slice(2)
            return createLocationState(
                "workspace",
                routeLayer,
                workspaceRest[0] ?? null,
                workspaceRest[1] ?? null,
                workspaceRest.join("/"),
            )
        }
    }

    const fallbackScope: URLLocationScope = routeLayer === "unknown" ? "unknown" : "public"

    return createLocationState(
        fallbackScope,
        routeLayer,
        first ?? null,
        segments[1] ?? null,
        segments.slice(1).join("/"),
    )
}

const urlLocationEquality = (prev: BaseURLLocationState, next: BaseURLLocationState) =>
    prev.key === next.key && prev.routeLayer === next.routeLayer

const baseUrlLocationAtom = selectAtom(
    appStateSnapshotAtom,
    resolveLocationFromSnapshot,
    urlLocationEquality,
)

export const urlLocationAtom = eagerAtom<URLLocationState>((get) => {
    const location = get(baseUrlLocationAtom)
    const evalType = get(previewEvalTypeAtom)
    const lastVisitedEvaluation = get(lastVisitedEvaluationAtom)

    return {
        ...location,
        resolvedSection: resolveOnboardingSection(location.section, {
            evalType,
            lastVisitedEvaluation,
        }),
    }
})

export const urlAtom = eagerAtom<URLState>((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const selectedOrg = get(selectedOrgAtom)
    const recentlyVisitedAppId = get(recentAppIdAtom)
    const {projectId, appId} = snapshot

    const workspaceName = selectedOrg?.name ?? ""
    const resolvedWorkspaceId = selectedOrg?.default_workspace?.id || ""

    const baseOrgURL = "/w"
    // Build URLs with workspace id (not name)
    const orgURL = resolvedWorkspaceId
        ? `${baseOrgURL}/${encodeURIComponent(resolvedWorkspaceId)}`
        : ""
    const baseProjectURL = resolvedWorkspaceId ? `${orgURL}/p` : ""
    const projectURL =
        resolvedWorkspaceId && projectId ? `${baseProjectURL}/${encodeURIComponent(projectId)}` : ""
    const baseAppURL = resolvedWorkspaceId && projectId ? `${projectURL}/apps` : ""
    const appURL =
        resolvedWorkspaceId && projectId && appId
            ? `${baseAppURL}/${encodeURIComponent(appId)}`
            : ""

    const recentlyVisitedAppURL =
        resolvedWorkspaceId && projectId && recentlyVisitedAppId
            ? `${baseAppURL}/${encodeURIComponent(recentlyVisitedAppId)}`
            : ""

    return {
        appId: appId ?? "",
        workspaceId: resolvedWorkspaceId,
        workspaceName,
        projectId: projectId ?? null,
        baseOrgURL,
        orgURL,
        baseProjectURL,
        projectURL,
        baseAppURL,
        appURL,
        recentlyVisitedAppURL,
    }
})

export const getURLValues = () => {
    const store = getDefaultStore()
    return store.get(urlAtom)
}

export interface WaitForUrlOptions {
    // Wait until org is known
    requireOrg?: boolean
    // Wait until projectId-backed URLs are available
    requireProject?: boolean
    // Wait until appId-backed URLs are available
    requireApp?: boolean
    // Maximum time to wait before resolving with a best-effort URL
    timeoutMs?: number
}

const satisfies = (state: URLState, opts: WaitForUrlOptions) => {
    const {requireOrg = false, requireProject = true, requireApp = false} = opts || {}
    if (requireOrg && !state.workspaceName) return false
    if (requireProject && !state.baseProjectURL) return false
    if (requireApp && !state.appURL) return false
    // For project-level readiness also ensure baseAppURL is known for convenience
    if (requireProject && !state.baseAppURL) return false
    return true
}

// Promise that resolves when URL state becomes valid per options
export const waitForValidURL = (options: WaitForUrlOptions = {}): Promise<URLState> => {
    const store = getDefaultStore()

    return new Promise<URLState>((resolve) => {
        let unsub: () => void = () => {}

        const check = () => {
            const current = store.get(urlAtom)
            if (process.env.NEXT_PUBLIC_APP_STATE_DEBUG === "true") {
                console.log("[url] waitForValidURL:tick", {
                    time: new Date().toISOString(),
                    current,
                    options,
                })
            }
            if (satisfies(current, options)) {
                unsub()
                resolve(current)
            }
        }

        unsub = store.sub(urlAtom, check)
        check()
    })
}

export {clearTraceParamAtom} from "./trace"
