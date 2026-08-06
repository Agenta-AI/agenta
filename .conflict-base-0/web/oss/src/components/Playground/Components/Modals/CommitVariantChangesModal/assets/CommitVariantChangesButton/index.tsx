import {cloneElement, isValidElement, useCallback, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {FloppyDiskBack, Plus} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {recordWidgetEventAtom} from "@/oss/lib/onboarding"

import {CommitVariantChangesButtonProps} from "../types"
const CommitVariantChangesModal = dynamic(() => import("../.."), {ssr: false})

const CommitVariantChangesButton = ({
    variantId,
    label,
    icon = true,
    children,
    onSuccess,
    ...props
}: CommitVariantChangesButtonProps) => {
    const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)
    const hasChanges = useAtomValue(workflowMolecule.selectors.isDirty(variantId || ""))
    const isEphemeral = useAtomValue(workflowMolecule.selectors.isEphemeral(variantId || ""))

    // Ephemeral entities are always "ready" (no dirty check needed — they need to be created)
    const disabled = !variantId || (!isEphemeral && !hasChanges)
    const resolvedLabel = isEphemeral ? "Create" : label
    const resolvedIcon = isEphemeral ? <Plus size={14} /> : <FloppyDiskBack size={14} />
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const handleSuccess = useCallback(
        (payload?: {revisionId?: string; variantId?: string}) => {
            recordWidgetEvent("playground_committed_change")
            onSuccess?.(payload ?? {})
        },
        [recordWidgetEvent, onSuccess],
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
                <Button
                    type="text"
                    icon={icon && resolvedIcon}
                    onClick={() => setIsDeployModalOpen(true)}
                    disabled={disabled}
                    {...props}
                >
                    {resolvedLabel}
                </Button>
            )}

            <CommitVariantChangesModal
                open={isDeployModalOpen}
                onCancel={() => setIsDeployModalOpen(false)}
                variantId={variantId}
                onSuccess={handleSuccess}
            />
        </>
    )
}

export default CommitVariantChangesButton
