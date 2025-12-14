import {cloneElement, isValidElement, useState} from "react"

import {PencilSimpleLine} from "@phosphor-icons/react"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"

import AnnotateDrawer from "../../index"
import {AnnotateDrawerButtonProps} from "../types"

const AnnotateDrawerButton = ({
    icon = true,
    children,
    data,
    label,
    traceSpanIds,
    showOnly,
    evalSlugs,
    ...props
}: AnnotateDrawerButtonProps) => {
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsDrawerOpen(true)
                        },
                    },
                )
            ) : (
                <EnhancedButton
                    label={label}
                    icon={icon && <PencilSimpleLine size={14} />}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDrawerOpen(true)
                    }}
                    {...props}
                />
            )}

            <AnnotateDrawer
                open={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                data={data}
                traceSpanIds={traceSpanIds}
                showOnly={showOnly}
                evalSlugs={evalSlugs}
            />
        </>
    )
}

export default AnnotateDrawerButton
