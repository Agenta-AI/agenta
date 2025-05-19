import {cloneElement, isValidElement, useCallback, useState} from "react"

import {CloudArrowUp} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {PlaygroundStateData} from "@/oss/lib/hooks/useStatelessVariants/types"
import {findRevisionDeployment} from "@/oss/lib/shared/variant/utils"
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
    const {
        environments,
        variantName,
        revision,
        mutate: mutatePlayground,
    } = usePlayground({
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
            [_environments, variantId, revisionId],
        ),
    })

    const onSuccess = useCallback(async () => {
        const newEnvironmentsData = await mutateEnv() // refetch environments or chain using .then

        mutatePlayground((state) => {
            const newEnv = newEnvironmentsData.map((env) => ({
                name: env.name,
                appId: env.app_id,
                deployedAppVariantId: env.deployed_app_variant_id,
                deployedVariantName: env.deployed_variant_name,
                deployedAppVariantRevisionId: env.deployed_app_variant_revision_id,
                revision: env.revision,
            }))

            // map available revisions and update each of them using the new environments data
            if (state.availableRevisions && state.availableRevisions.length > 0) {
                state.availableRevisions?.forEach((availableRevision) => {
                    if (availableRevision) {
                        availableRevision.deployedIn = findRevisionDeployment(
                            availableRevision.id,
                            newEnv,
                        )
                    }
                })
            }

            // update already mounted data in state.revisions
            if (state.variants && state.variants.length > 0) {
                state.variants?.forEach((revision) => {
                    if (revision) {
                        revision.deployedIn = findRevisionDeployment(revision.id, newEnv)
                    }
                })
            }

            return state
        })
    }, [])

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
