import {cloneElement, isValidElement, useState} from "react"

import {Question} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"

const InstructionModal = dynamic(() => import("../index"), {ssr: false})

const InstructionButton = ({
    icon = true,
    children,
    label,
    ...props
}: {
    icon?: boolean
    children?: React.ReactNode
    label?: string
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false)

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsModalOpen(true)
                        },
                    },
                )
            ) : (
                <EnhancedButton
                    type="default"
                    icon={icon && <Question size={14} />}
                    onClick={() => setIsModalOpen(true)}
                    tooltipProps={icon && !label ? {title: "Instructions"} : {}}
                    label={label}
                    {...props}
                />
            )}

            <InstructionModal open={isModalOpen} onCancel={() => setIsModalOpen(false)} />
        </>
    )
}

export default InstructionButton
