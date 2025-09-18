import {cloneElement, isValidElement, useEffect, useState} from "react"

import {FloppyDiskBack} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {variantIsDirtyAtomFamily} from "@/oss/components/Playground/state/atoms"

import {CommitVariantChangesButtonProps} from "../types"
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
    const disabled = !useAtomValue(variantIsDirtyAtomFamily(variantId || ""))

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
                onSuccess={onSuccess}
                commitType={commitType}
            />
        </>
    )
}

export default CommitVariantChangesButton
