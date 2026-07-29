import {cloneElement, isValidElement, useCallback, useMemo, useState} from "react"

import {
    workflowDetailQueryAtomFamily,
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
} from "@agenta/entities/workflow"
import {CloudArrowUp} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import {useAppEnvironments} from "@/oss/state/environment/useAppEnvironments"

import {DeployVariantButtonProps} from "./types"

const DeployVariantModal = dynamic(() => import("../.."), {ssr: false})

// Mounted only after the first click — holds the environments + variants-list
// subscriptions so rendering the button alone never fires those queries.
const DeployVariantModalHost = ({
    open,
    onCancel,
    variantId,
    revisionId,
}: {
    open: boolean
    onCancel: () => void
    variantId?: string
    revisionId?: string
}) => {
    const {
        environments: _environments,
        mutate: mutateEnv,
        isEnvironmentsLoading,
    } = useAppEnvironments()

    const runnableData = useAtomValue(workflowMolecule.selectors.data(revisionId || ""))
    const workflowId = runnableData?.workflow_id || ""
    const variants = useAtomValue(workflowVariantsListDataAtomFamily(workflowId))

    const {environments, variantName, revision} = useMemo(() => {
        const variantEntity = variants.find((v) => v.id === runnableData?.workflow_variant_id)
        return {
            variantName: variantEntity?.name || runnableData?.name || "",
            revision: runnableData?.version ?? "",
            environments: _environments,
        }
    }, [runnableData, variants, _environments])

    const onSuccess = useCallback(async () => {
        await mutateEnv()
    }, [mutateEnv])

    return (
        <DeployVariantModal
            open={open}
            onCancel={onCancel}
            variantId={variantId}
            revisionId={revisionId}
            environments={environments}
            mutate={onSuccess}
            variantName={variantName}
            revision={revision}
            isLoading={isEnvironmentsLoading}
        />
    )
}

const DeployVariantButton = ({
    variantId,
    revisionId,
    label,
    icon = true,
    children,
    ...props
}: DeployVariantButtonProps) => {
    const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)
    // Sticky latch — data queries (environments, variants) mount on first open only.
    const [modalActivated, setModalActivated] = useState(false)

    const runnableData = useAtomValue(workflowMolecule.selectors.data(revisionId || ""))
    const workflowId = runnableData?.workflow_id || ""
    // Workflow-level evaluator flag — canonical, unlike the revision-level
    // `flags.is_evaluator` which is `false` on v0 revisions of evaluators.
    // Read via the workflow-keyed detail query (cache-shared with the router);
    // the revision molecule is revision-keyed, and feeding it a workflow id
    // fired a guaranteed-null /revisions/query on every playground load.
    const workflowDetail = useAtomValue(workflowDetailQueryAtomFamily(workflowId || null))
    const isEvaluator = Boolean(workflowDetail.data?.flags?.is_evaluator)

    const handleOpenDeployModal = useCallback(() => {
        setModalActivated(true)
        setIsDeployModalOpen(true)
    }, [])
    const handleCloseDeployModal = useCallback(() => setIsDeployModalOpen(false), [])

    // Evaluator workflows aren't deployed to environments — never render a
    // deploy trigger for them. Central guard so every surface that reuses this
    // button (registry/overview menus, variant headers, the revision drawer) is
    // covered without each call site repeating the check.
    if (isEvaluator) return null

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: handleOpenDeployModal,
                    },
                )
            ) : (
                <EnhancedButton
                    type="text"
                    icon={icon && <CloudArrowUp size={14} />}
                    onClick={handleOpenDeployModal}
                    tooltipProps={icon && !label ? {title: "Deploy"} : {}}
                    label={label}
                    {...props}
                />
            )}

            {modalActivated && (
                <DeployVariantModalHost
                    open={isDeployModalOpen}
                    onCancel={handleCloseDeployModal}
                    variantId={variantId}
                    revisionId={revisionId}
                />
            )}
        </>
    )
}

export default DeployVariantButton
