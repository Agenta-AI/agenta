/** The drill-in `skills` bridge implementation each host feeds its DrillInUIProvider. */
import {useMemo} from "react"

import {skillsListDataAtom} from "@agenta/skills/state"
import type {SkillsBridge} from "@agenta/ui/drill-in"
import {useAtomValue} from "jotai"

import {SkillDetailHost} from "./SkillDetailHost"
import {SkillPickerHost} from "./SkillPickerHost"

/** Registry head versions by workflow slug — feeds the config rows' "vN available" nudge. */
function useHeadVersions(): Record<string, string> {
    const skills = useAtomValue(skillsListDataAtom)
    return useMemo(() => {
        const heads: Record<string, string> = {}
        for (const item of skills) {
            if (item.workflow_slug && item.version) {
                heads[item.workflow_slug] = item.version.replace(/^v/, "")
            }
        }
        return heads
    }, [skills])
}

export function useSkillsBridge(): SkillsBridge {
    return useMemo(
        () => ({
            enabled: true,
            PickerHost: SkillPickerHost,
            DetailHost: SkillDetailHost,
            useHeadVersions,
        }),
        [],
    )
}
