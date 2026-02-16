import {Dispatch, SetStateAction} from "react"

import {EvaluationRow} from "../../types"

export interface TableDropdownMenuProps {
    record: EvaluationRow
    onVariantNavigation: (params: {revisionId: string; appId?: string}) => void
    setSelectedEvalRecord: Dispatch<SetStateAction<EvaluationRow | undefined>>
    setIsDeleteEvalModalOpen: Dispatch<SetStateAction<boolean>>
    evalType?: "human" | "auto"
    baseAppURL: string
    extractAppId: (evaluation: EvaluationRow) => string | undefined
    resolveAppId?: (evaluation: EvaluationRow) => string | undefined
    scope: "app" | "project"
    projectURL: string
    disableVariantAction?: boolean
}
