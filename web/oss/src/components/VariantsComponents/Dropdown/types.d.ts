import type {Workflow} from "@agenta/entities/workflow"

type VariantDropdownHandler<T> = ((record: T) => void) | undefined
export interface VariantDropdownProps<T = Workflow> {
    handleOpenDetails: VariantDropdownHandler<T>
    handleOpenInPlayground: VariantDropdownHandler<T>
    handleDeploy: VariantDropdownHandler<T>
    handleDeleteVariant: VariantDropdownHandler<T>
    record: T
}

export interface VariantDrawerTitleMenuProps {
    onClose: () => void
    onRename: () => void
    onReset: () => void
}
