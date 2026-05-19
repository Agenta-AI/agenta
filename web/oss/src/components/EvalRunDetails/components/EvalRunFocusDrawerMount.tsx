import {memo} from "react"

import {useAtomValue} from "jotai"

import {focusScenarioAtom} from "../state/focusDrawerAtom"
import {evalUnifiedDrawerEnabledAtom} from "../state/unifiedDrawerFlag"

import EvalTestcaseDrawerAdapter from "./EvalTestcaseDrawerAdapter"
import FocusDrawer from "./FocusDrawer"

const EvalRunFocusDrawerMount = () => {
    const unifiedDrawerEnabled = useAtomValue(evalUnifiedDrawerEnabledAtom)
    const focus = useAtomValue(focusScenarioAtom)

    if (unifiedDrawerEnabled && !focus) {
        return null
    }

    if (unifiedDrawerEnabled && focus?.compareMode !== true) {
        return <EvalTestcaseDrawerAdapter />
    }

    return <FocusDrawer />
}

export default memo(EvalRunFocusDrawerMount)
