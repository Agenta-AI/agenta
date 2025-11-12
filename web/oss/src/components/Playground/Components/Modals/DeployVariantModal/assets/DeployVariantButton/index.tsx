import {cloneElement, isValidElement, useMemo} from "react"

import {CloudArrowUp} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms"

import {openDeployVariantModalAtom} from "../../store/deployVariantModalStore"

import {DeployVariantButtonProps} from "./types"

const DeployVariantButton = ({
    variantId,
    revisionId,
    label,
    icon = true,
    children,
    ...props
}: DeployVariantButtonProps) => {
    const openDeployModal = useSetAtom(openDeployVariantModalAtom)

    const revisionKey = revisionId ?? variantId ?? ""
    const variant = revisionKey ? (useAtomValue(variantByRevisionIdAtomFamily(revisionKey)) as any) : null

    const payload = useMemo(() => {
        const inferredRevisionId = revisionId ?? variant?.id ?? null
        const inferredParentVariantId =
            typeof variant?.variantId === "string" ? variant.variantId : variantId ?? null

        const variantName = variant?.variantName ?? variant?.name ?? label ?? "Variant"
        const revision = variant?.revisionNumber ?? variant?.revision ?? ""

        return {
            parentVariantId: inferredParentVariantId ?? null,
            revisionId: inferredRevisionId ?? null,
            variantName,
            revision,
            mutate: undefined,
        }
    }, [variant, variantId, revisionId, label])

    const handleOpen = () => {
        if (!payload.revisionId && !payload.parentVariantId) return
        openDeployModal(payload as any)
    }

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: handleOpen,
                    },
                )
            ) : (
                <EnhancedButton
                    type="text"
                    icon={icon && <CloudArrowUp size={14} />}
                    onClick={handleOpen}
                    tooltipProps={icon && !label ? {title: "Deploy"} : {}}
                    label={label}
                    {...props}
                />
            )}
        </>
    )
}

export default DeployVariantButton
