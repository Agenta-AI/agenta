import {cloneElement, isValidElement, useMemo, useState} from "react"

import {CloudArrowUp} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/EnhancedUIs/EnhancedButton"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"

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

    // Focused read for the specific revision's metadata
    const variant = useAtomValue(variantByRevisionIdAtomFamily(revisionId)) as any

    const {environments, variantName, revision} = useMemo(() => {
        return {
            variantName: variant?.variantName || "",
            revision: (variant as any)?.revisionNumber ?? (variant as any)?.revision ?? "",
            environments: _environments,
        }
    }, [variant, _environments])

    const onSuccess = async () => {
        // Just refetch environments - the revisionListAtom will automatically update
        // when the deployment state changes through SWR revalidation
        await mutateEnv()
    }

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
                onCancel={() => setIsDeployModalOpen(false)}
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
