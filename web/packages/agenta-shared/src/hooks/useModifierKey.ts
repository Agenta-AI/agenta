import {useMemo} from "react"

import {modifierKeyLabel} from "../utils/platform"

export function useModifierKey(): string {
    return useMemo(() => modifierKeyLabel(), [])
}
