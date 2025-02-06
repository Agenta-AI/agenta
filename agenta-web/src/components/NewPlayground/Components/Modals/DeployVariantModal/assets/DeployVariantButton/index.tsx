import {cloneElement, isValidElement, useState} from "react"
import dynamic from "next/dynamic"
import {Rocket} from "@phosphor-icons/react"
import {DeployVariantButtonProps} from "./types"
import EnhancedButton from "@/components/NewPlayground/assets/EnhancedButton"
const DeployVariantModal = dynamic(() => import("../.."), {ssr: false})

const DeployVariantButton = ({
    variantId,
    label,
    icon = true,
    children,
    ...props
}: DeployVariantButtonProps) => {
    const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)

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
                    icon={icon && <Rocket size={14} />}
                    onClick={() => setIsDeployModalOpen(true)}
                    tooltipProps={icon ? {title: "Deploy"} : {}}
                    {...props}
                >
                    {label}
                </EnhancedButton>
            )}

            {isDeployModalOpen && (
                <DeployVariantModal
                    open={isDeployModalOpen}
                    onCancel={() => setIsDeployModalOpen(false)}
                    variantId={variantId}
                />
            )}
        </>
    )
}

export default DeployVariantButton
