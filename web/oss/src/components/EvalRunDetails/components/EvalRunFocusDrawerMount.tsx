import {memo} from "react"

import {useAtomValue} from "jotai"

import {focusScenarioAtom} from "../state/focusDrawerAtom"

import EvalTestcaseDrawerAdapter from "./EvalTestcaseDrawerAdapter"
import FocusDrawer from "./FocusDrawer"

const EvalRunFocusDrawerMount = () => {
    const focus = useAtomValue(focusScenarioAtom)

    if (!focus) return null
    if (focus.compareMode === true) return <FocusDrawer />
    return <EvalTestcaseDrawerAdapter />
}

export default memo(EvalRunFocusDrawerMount)
