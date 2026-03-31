import {cloneElement, isValidElement, useCallback, useMemo, useState} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import {CloudArrowUp} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import {useEnvironments} from "@/oss/state/environment/hooks/useEnvironments"

import {DeployVariantButtonProps} from "./types"

const DeployVariantModal = dynamic(() => import("../.."), {ssr: false})

const DeployVariantButton = ({
    variantId,
    revisionId,
    label,
    icon = true,
    children,
    ...props
}: DeployVariantButtonProps) => {
    const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)
    const {
        environments: _environments,
        mutate: mutateEnv,
        isEnvironmentsLoading,
    } = useEnvironments()

    // Use runnableBridge for entity-type-aware data access
    const runnableData = useAtomValue(runnableBridge.data(revisionId || ""))

    const {environments, variantName, revision} = useMemo(() => {
        return {
            variantName: runnableData?.name || "",
            revision: runnableData?.version ?? "",
            environments: _environments,
        }
    }, [runnableData, _environments])

    const onSuccess = useCallback(async () => {
        await mutateEnv()
    }, [mutateEnv])

    const handleCloseDeployModal = useCallback(() => setIsDeployModalOpen(false), [])

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
                    icon={icon && <CloudArrowUp size={14} />}
                    onClick={() => setIsDeployModalOpen(true)}
                    tooltipProps={icon && !label ? {title: "Deploy"} : {}}
                    label={label}
                    {...props}
                />
            )}

            <DeployVariantModal
                open={isDeployModalOpen}
                onCancel={handleCloseDeployModal}
                variantId={variantId}
                revisionId={revisionId}
                environments={environments}
                mutate={onSuccess}
                variantName={variantName}
                revision={revision}
                isLoading={isEnvironmentsLoading}
            />
        </>
    )
}

export default DeployVariantButton
