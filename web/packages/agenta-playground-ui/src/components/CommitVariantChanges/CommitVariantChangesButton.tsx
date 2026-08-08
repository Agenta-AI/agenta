import {cloneElement, isValidElement, useCallback, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {FloppyDiskBack, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import CommitVariantChangesModal from "./CommitVariantChangesModal"
import {CommitVariantChangesButtonProps} from "./types"

const CommitVariantChangesButton = ({
    variantId,
    label,
    icon = true,
    children,
    onSuccess,
    appId,
    onAfterCommit,
    onCommitted,
    ...props
}: CommitVariantChangesButtonProps) => {
    const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)
    const hasChanges = useAtomValue(workflowMolecule.selectors.isDirty(variantId || ""))
    const isEphemeral = useAtomValue(workflowMolecule.selectors.isEphemeral(variantId || ""))

    // Ephemeral entities are always "ready" (no dirty check needed — they need to be created)
    const disabled = !variantId || (!isEphemeral && !hasChanges)
    const resolvedLabel = isEphemeral ? "Create" : label
    const resolvedIcon = isEphemeral ? <Plus size={14} /> : <FloppyDiskBack size={14} />
    const handleSuccess = useCallback(
        (payload?: {revisionId?: string; variantId?: string}) => {
            onCommitted?.()
            onSuccess?.(payload ?? {})
        },
        [onCommitted, onSuccess],
    )

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsDeployModalOpen(true)
                        },
                    },
                )
            ) : (
                <EnhancedButton
                    type="text"
                    icon={icon && resolvedIcon}
                    onClick={() => setIsDeployModalOpen(true)}
                    disabled={disabled}
                    {...props}
                >
                    {resolvedLabel}
                </EnhancedButton>
            )}

            <CommitVariantChangesModal
                open={isDeployModalOpen}
                onCancel={() => setIsDeployModalOpen(false)}
                variantId={variantId}
                appId={appId}
                onAfterCommit={onAfterCommit}
                onSuccess={handleSuccess}
            />
        </>
    )
}

export default CommitVariantChangesButton
