import {Dispatch, SetStateAction} from "react"
import {EvaluationRow} from "../../types"

export interface TableDropdownMenuProps {
    record: EvaluationRow
    onVariantNavigation: (revisionId: string) => void
    setSelectedEvalRecord: Dispatch<SetStateAction<EvaluationRow | undefined>>
    setIsDeleteEvalModalOpen: Dispatch<SetStateAction<boolean>>
    evalType?: "human" | "auto"
}
