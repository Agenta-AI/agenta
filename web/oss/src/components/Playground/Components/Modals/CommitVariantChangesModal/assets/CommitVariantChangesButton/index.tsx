import {cloneElement, isValidElement, useCallback, useState} from "react"

import {FloppyDiskBack} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {revisionIsDirtyAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

import {CommitVariantChangesButtonProps} from "../types"
import { recordWidgetEventAtom } from "@/oss/lib/onboarding"
const CommitVariantChangesModal = dynamic(() => import("../.."), {ssr: false})

const CommitVariantChangesButton = ({
    variantId,
    label,
    icon = true,
    children,
    onSuccess,
    commitType,
    ...props
}: CommitVariantChangesButtonProps) => {
    const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)
    const isDirty = useAtomValue(revisionIsDirtyAtomFamily(variantId || ""))
    const disabled = !variantId || !isDirty
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const handleSuccess = useCallback(() => {
        recordWidgetEvent("playground_committed_change")
        onSuccess?.({
            variantId,
            revisionId: variantId
        })
    }, [recordWidgetEvent, onSuccess, variantId])
    
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
                commitType={commitType}
            />
        </>
    )
}

export default CommitVariantChangesButton
