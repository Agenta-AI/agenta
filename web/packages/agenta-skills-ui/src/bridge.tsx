/** The drill-in `skills` bridge implementation each host feeds its DrillInUIProvider. */
import {useMemo} from "react"

import type {SkillsBridge} from "@agenta/ui/drill-in"

import {SkillDetailHost} from "./SkillDetailHost"
import {SkillPickerHost} from "./SkillPickerHost"

export function useSkillsBridge(): SkillsBridge {
    return useMemo(
        () => ({enabled: true, PickerHost: SkillPickerHost, DetailHost: SkillDetailHost}),
        [],
    )
}
