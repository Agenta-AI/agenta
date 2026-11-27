import {useMemo} from "react"

import type {SkillRegistryItem} from "@agenta/skills"
import {skillsResolveQueryAtom} from "@agenta/skills/state"
import {useAtomValue} from "jotai"

import {toSkillListItem, toSourceInfo} from "./registrySections"
import type {SkillListItem} from "./types"

/** The registry entry with this workflow slug: project skills (archived too), then built-ins. */
export const useRegistrySkill = (slug: string) => {
    const query = useAtomValue(skillsResolveQueryAtom)
    const {item, raw} = useMemo<{item: SkillListItem | null; raw: SkillRegistryItem | null}>(() => {
        const matches = (entry: {workflow_slug?: string | null}) => entry.workflow_slug === slug
        const project = query.data?.skills?.find(matches)
        if (project) {
            const mapped = toSkillListItem(project, project.origin ? "imported" : "project")
            return {
                item: project.origin ? {...mapped, source: toSourceInfo(project.origin)} : mapped,
                raw: project,
            }
        }
        const builtin = query.data?.builtin?.find(matches)
        return builtin
            ? {item: toSkillListItem(builtin, "builtin"), raw: builtin}
            : {item: null, raw: null}
    }, [query.data, slug])
    return {item, raw, query}
}
