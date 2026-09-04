/**
 * Desktop `useObservability`.
 *
 * Same 40-key shape the page has always consumed — the packaged hook owns every
 * key except the add-to-testset drawer payload, which stays host state.
 */
import {useObservability as usePackagedObservability} from "@agenta/observability"
import {useAtom} from "jotai"

import {testsetDrawerDataAtom} from "./atoms"

export const useObservability = () => {
    const observability = usePackagedObservability()
    const [testsetDrawerData, setTestsetDrawerData] = useAtom(testsetDrawerDataAtom)

    return {...observability, testsetDrawerData, setTestsetDrawerData}
}
