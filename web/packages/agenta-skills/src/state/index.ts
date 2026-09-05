/**
 * Skill registry state.
 *
 * Mirrors the evaluator list atoms' SHAPE (atomWithQuery, focused list, 30s staleTime,
 * derived views) but NOT their invalidation: `invalidateEvaluatorsListCache` goes through
 * `getDefaultStore()+queryClientAtom`, which breaks when a host app owns its own
 * QueryClient (see the package-QueryClient-singleton trap). Skills invalidation resolves
 * `getHostQueryClient()` per call instead.
 */
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {querySkills} from "../api"
import type {SkillRegistryItem, SkillsQueryResponse} from "../core/schema"

/** Server-side search text for the registry list ("" = no filter). */
export const skillsSearchAtom = atom("")

export const skillsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const search = get(skillsSearchAtom).trim()
    return {
        queryKey: ["skills", "registry", "list", projectId, search],
        queryFn: async (): Promise<SkillsQueryResponse> => {
            if (!projectId) return {count: 0, skills: [], builtin: []}
            return querySkills({projectId, search: search || undefined})
        },
        enabled: Boolean(get(sessionAtom)) && !!projectId,
        staleTime: 30_000,
    }
})

/** Project-authored registry skills (paginated block). */
export const skillsListDataAtom = atom<SkillRegistryItem[]>((get) => {
    const query = get(skillsListQueryAtom)
    return query.data?.skills ?? []
})

/** Code-defined Agenta built-ins (separate, unpaginated block). */
export const builtinSkillsAtom = atom<SkillRegistryItem[]>((get) => {
    const query = get(skillsListQueryAtom)
    return query.data?.builtin ?? []
})

/** Drop every cached skills list; the next subscriber refetches. */
export function invalidateSkillsListCache(): void {
    void getHostQueryClient().invalidateQueries({
        queryKey: ["skills", "registry", "list"],
    })
}
