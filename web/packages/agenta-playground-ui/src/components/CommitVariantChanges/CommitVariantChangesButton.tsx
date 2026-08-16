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
    const dirtyGuard = !variantId || (!isEphemeral && !hasChanges)
    // ONE effective value for both branches. A caller may only tighten the guard, never loosen it:
    // the custom-child branch renders whatever it was given (it cannot be disabled), and in the
    // standard branch `{...props}` used to spread AFTER `disabled` and overrode it. Either way an
    // unchanged persisted variant could open the commit modal on a host that passed `disabled={false}`.
    const isDisabled = dirtyGuard || Boolean(props.disabled)
    const resolvedLabel = isEphemeral ? "Create" : label
    const resolvedIcon = isEphemeral ? <Plus size={14} /> : <FloppyDiskBack size={14} />
    // The handler carries the guard too, so it holds whichever branch renders.
    const openModal = useCallback(() => {
        if (isDisabled) return
        setIsDeployModalOpen(true)
    }, [isDisabled])
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
                        onClick: openModal,
                    },
                )
            ) : (
                <EnhancedButton
                    type="text"
                    icon={icon && resolvedIcon}
                    onClick={openModal}
                    {...props}
                    // AFTER the spread: `disabled` is the package's call, not the host's.
                    disabled={isDisabled}
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
