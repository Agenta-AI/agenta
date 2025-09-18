import {useAtomValue, useSetAtom} from "jotai"
import {selectAtom} from "jotai/utils"

import {comparisonModalAtom, closeComparisonModalAtom} from "./store/comparisonModalStore"

import VariantComparisonModal from "./index"

// Create selector atom once at module scope to keep it stable across renders
const comparisonModalOpenAtom = selectAtom(comparisonModalAtom, (s) => s.open)

const VariantComparisonModalWrapper = () => {
    const open = useAtomValue(comparisonModalOpenAtom)
    const close = useSetAtom(closeComparisonModalAtom)

    return <VariantComparisonModal open={open} onCancel={() => close()} />
}

export default VariantComparisonModalWrapper
