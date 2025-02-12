import {cloneElement, isValidElement, useState} from "react"
import dynamic from "next/dynamic"
import {Button} from "antd"
import {ArrowsOut} from "@phosphor-icons/react"
import {PromptComparisonFocusButtonProps} from "./types"
const PromptComparisonFocusDrawer = dynamic(() => import("../.."), {ssr: false})

const PromptComparisonFocusButton = ({
    variantId,
    label,
    icon = true,
    children,
    ...props
}: PromptComparisonFocusButtonProps) => {
    const [isPromptFocusOpen, setIsPromptFocusOpen] = useState(false)

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsPromptFocusOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    type="text"
                    icon={icon && <ArrowsOut size={14} />}
                    onClick={() => setIsPromptFocusOpen(true)}
                    {...props}
                >
                    {label}
                </Button>
            )}

            {isPromptFocusOpen && (
                <PromptComparisonFocusDrawer
                    open={isPromptFocusOpen}
                    onClose={() => setIsPromptFocusOpen(false)}
                    variantId={variantId}
                />
            )}
        </>
    )
}

export default PromptComparisonFocusButton
