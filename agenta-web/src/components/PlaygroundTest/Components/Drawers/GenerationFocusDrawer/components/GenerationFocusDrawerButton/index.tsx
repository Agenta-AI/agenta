import {useState} from "react"
import dynamic from "next/dynamic"
import {Button} from "antd"
import {ArrowsOut} from "@phosphor-icons/react"
import {GenerationFocusDrawerButtonProps} from "./types"
const GenerationFocusDrawer = dynamic(() => import("../.."), {ssr: false})

const GenerationFocusDrawerButton = ({
    variantIds,
    children,
    icon = true,
    ...props
}: GenerationFocusDrawerButtonProps) => {
    const [isOpenFocusDrawer, setIsOpenFocusDrawer] = useState(false)

    return (
        <>
            <Button
                type="text"
                icon={icon && <ArrowsOut size={14} />}
                onClick={() => setIsOpenFocusDrawer(true)}
                {...props}
            >
                {children}
            </Button>

            {isOpenFocusDrawer && (
                <GenerationFocusDrawer
                    variantId={variantIds as string}
                    open={isOpenFocusDrawer}
                    onClose={() => setIsOpenFocusDrawer(false)}
                    type="completion"
                />
            )}
        </>
    )
}

export default GenerationFocusDrawerButton
