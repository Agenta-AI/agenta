import {cloneElement, isValidElement, useCallback, useState} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {FloppyDiskBack} from "@phosphor-icons/react"
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
    const hasChanges = useAtomValue(legacyAppRevisionMolecule.atoms.hasChanges(variantId || ""))
    const disabled = !variantId || !hasChanges
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const handleSuccess = useCallback(
        (payload?: {revisionId?: string; variantId?: string}) => {
            recordWidgetEvent("playground_committed_change")
            onSuccess?.(payload)
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
                    icon={icon && <FloppyDiskBack size={14} />}
                    onClick={() => setIsDeployModalOpen(true)}
                    disabled={disabled}
                    {...props}
                >
                    {label}
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
