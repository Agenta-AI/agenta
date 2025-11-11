import {cloneElement, isValidElement, memo, useState} from "react"

import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
import {RenameEvalButtonProps} from "../../types"
import {EditOutlined} from "@ant-design/icons"

const RenameEvalModal = dynamic(() => import(".."), {ssr: false})

const RenameEvalButton = ({
    id,
    name,
    description,
    icon = true,
    children,
    label,
    ...props
}: RenameEvalButtonProps) => {
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
                    icon={icon && <EditOutlined size={14} />}
                    onClick={() => setIsModalOpen(true)}
                    tooltipProps={icon && !label ? {title: "Rename the eval run"} : {}}
                    label={label}
                    {...props}
                />
            )}

            <RenameEvalModal
                id={id}
                name={name}
                description={description}
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
            />
        </>
    )
}

export default memo(RenameEvalButton)
