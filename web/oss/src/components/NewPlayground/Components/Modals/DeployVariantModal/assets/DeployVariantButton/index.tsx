import {cloneElement, isValidElement, useCallback, useState} from "react"

import {CloudArrowUp} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/NewPlayground/assets/EnhancedButton"
import usePlayground from "@/oss/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/oss/lib/hooks/useStatelessVariants/types"
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
    const {environments: _environments, mutate, isEnvironmentsLoading} = useEnvironments()
    const {environments, variantName, revision} = usePlayground({
        variantId: revisionId || variantId,
        hookId: "DeployVariantModal",
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const variant = state.availableRevisions?.find((rev) => rev.id === revisionId)
                return {
                    variantName: variant?.variantName || "",
                    revision: variant?.revisionNumber || "",
                    _revisionId: variant?.id || "",
                    environments: _environments.map((env) => {
                        const deployedAppRevisionId = env.deployed_app_variant_revision_id
                        const revision = state.availableRevisions?.find(
                            (rev) => rev.id === deployedAppRevisionId,
                        )
                        return {
                            ...env,
                            revision: revision,
                        }
                    }),
                }
            },
            [_environments],
        ),
    })

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
                    tooltipProps={icon ? {title: "Deploy"} : {}}
                    {...props}
                >
                    {label}
                </EnhancedButton>
            )}

            <DeployVariantModal
                open={isDeployModalOpen}
                onCancel={() => setIsDeployModalOpen(false)}
                variantId={variantId}
                revisionId={revisionId}
                environments={environments}
                mutate={mutate}
                variantName={variantName}
                revision={revision}
                isLoading={isEnvironmentsLoading}
            />
        </>
    )
}

export default DeployVariantButton
