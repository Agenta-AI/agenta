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
import type {RegistrySource, SkillRegistryItem, SkillsQueryResponse} from "../core/schema"

/** Server-side search text for the registry list ("" = no filter). */
export const skillsSearchAtom = atom("")

/** Include archived skills in the registry list (off by default). */
export const skillsShowArchivedAtom = atom(false)

export const skillsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const search = get(skillsSearchAtom).trim()
    const includeArchived = get(skillsShowArchivedAtom)
    return {
        queryKey: ["skills", "registry", "list", projectId, search, includeArchived],
        queryFn: async (): Promise<SkillsQueryResponse> => {
            if (!projectId) return {count: 0, skills: [], builtin: []}
            return querySkills({
                projectId,
                search: search || undefined,
                includeArchived: includeArchived || undefined,
            })
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

/**
 * Code-defined Agenta built-ins (separate, unpaginated block). The API returns
 * them unfiltered, so the registry search is applied client-side here.
 */
export const builtinSkillsAtom = atom<SkillRegistryItem[]>((get) => {
    const query = get(skillsListQueryAtom)
    const builtin = query.data?.builtin ?? []
    const search = get(skillsSearchAtom).trim().toLowerCase()
    if (!search) return builtin
    return builtin.filter((item) =>
        [item.skill_name, item.name, item.description, item.skill_description].some((field) =>
            field?.toLowerCase().includes(search),
        ),
    )
})

/** Import sources referenced by skills[].source_id — the per-repo sections. */
export const registrySourcesAtom = atom<RegistrySource[]>((get) => {
    const query = get(skillsListQueryAtom)
    return query.data?.sources ?? []
})

/** Drop every cached skills list; the next subscriber refetches. */
export function invalidateSkillsListCache(): void {
    void getHostQueryClient().invalidateQueries({
        queryKey: ["skills", "registry", "list"],
    })
}
