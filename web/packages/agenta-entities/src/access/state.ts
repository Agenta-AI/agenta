import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchProjectPermission, projectPermissionQueryKey} from "./api"

/**
 * One effective permission of the signed-in person in the project on screen.
 *
 * Package code cannot call the app's permission hook, so the check lives here and reads the
 * project from `projectIdAtom`, the one project any surface is scoped to.
 */
const projectPermissionQueryAtomFamily = atomFamily((action: string) =>
    atomWithQuery<boolean>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: projectPermissionQueryKey(projectId ?? "", action),
            queryFn: () => fetchProjectPermission(projectId ?? "", action),
            enabled: Boolean(get(sessionAtom) && projectId),
            staleTime: 30_000,
            retry: false,
        }
    }),
)

/**
 * Does the reader hold `action` here? False while the check is in flight and false on an error,
 * so a gated read is never sent before the answer is in.
 */
export const projectPermissionAtomFamily = atomFamily((action: string) =>
    atom((get) => get(projectPermissionQueryAtomFamily(action)).data === true),
)

/**
 * May the reader read trace content (spans, traces and analytics) in this project?
 *
 * Every trace read in the packages gates on this, so a role without `view_spans` sends no span,
 * trace or analytics request at all instead of collecting refusals that read as missing data.
 */
export const canViewSpansAtom = projectPermissionAtomFamily("view_spans")

/**
 * Is the `view_spans` check still in flight? A reader who may read traces should see
 * "loading", not "no data", until the answer is in.
 */
export const canViewSpansPendingAtom = atom(
    (get) => get(projectPermissionQueryAtomFamily("view_spans")).isLoading,
)
