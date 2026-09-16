/**
 * The drill-in bridge's skill DETAIL surface: resolves an embed slug against the live
 * registry and renders the same SkillDetailDrawer the registry page opens — so clicking a
 * skill row in the agent config lands in versions/edit/save, not a raw JSON editor.
 * An unresolvable slug renders nothing; the PANEL falls back to the JSON round-trip.
 */
import {useMemo} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {skillsResolveDataAtom} from "@agenta/skills/state"
import {useAtomValue} from "jotai"

import {toSkillListItem, toSourceInfo} from "./registrySections"
import {SkillDetailDrawer} from "./SkillDetailDrawer"
import type {SkillListItem} from "./types"

export function SkillDetailHost({
    open,
    onClose,
    slug,
}: {
    open: boolean
    onClose: () => void
    slug: string | null
}) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    // Archived-inclusive: a config row referencing an archived skill still opens here.
    const projectSkills = useAtomValue(skillsResolveDataAtom)

    const item = useMemo<SkillListItem | null>(() => {
        if (!slug) return null
        const match = projectSkills.find(
            (skill) => skill.workflow_slug === slug || skill.skill_name === slug,
        )
        if (!match) return null
        const mapped = toSkillListItem(match, match.origin ? "imported" : "project")
        return match.origin ? {...mapped, source: toSourceInfo(match.origin)} : mapped
    }, [projectSkills, slug])

    return (
        <SkillDetailDrawer
            open={open && item !== null}
            onClose={onClose}
            projectId={projectId}
            skill={item}
        />
    )
}
