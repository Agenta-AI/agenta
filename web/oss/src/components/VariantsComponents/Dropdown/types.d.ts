import type {EnhancedObjectConfig} from "@agenta/entities/legacyAppRevision"

import {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/types"

type VariantDropdownHandler<T> = ((record: T) => void) | undefined
export interface VariantDropdownProps<
    T = EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>,
> {
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
