import {memo} from "react"

import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {urlStateAtom} from "../../state/urlState"

import ScenarioTable from "./ScenarioTable"

const ComparisonTable = dynamic(() => import("./ComparisonScenarioTable"), {ssr: false})

const VirtualizedScenarioTable = () => {
    const urlState = useAtomValue(urlStateAtom)
    const isComparisonMode = Boolean(urlState.compare && urlState.compare.length > 0)

    if (isComparisonMode) {
        return <ComparisonTable />
    }

    return <ScenarioTable />
}

export default VirtualizedScenarioTable
