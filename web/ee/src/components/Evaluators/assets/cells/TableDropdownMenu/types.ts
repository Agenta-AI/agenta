import {EvaluatorCategory, EvaluatorRegistryRow} from "../../types"

export interface TableDropdownMenuProps {
    record: EvaluatorRegistryRow
    category: EvaluatorCategory
    onEdit?: (record: EvaluatorRegistryRow) => void
    onConfigure?: (record: EvaluatorRegistryRow) => void
    onDelete: (record: EvaluatorRegistryRow) => void
}
