import {cloneElement, isValidElement, ReactElement} from "react"

import {Database} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"

import {isAddToTestsetDrawerOpenAtom} from "../../store/atom"
import TestsetDrawer from "../../TestsetDrawer"

import {AddToTestsetButtonProps} from "./types"

const AddToTestsetButton = ({
    label,
    icon = true,
    children,
    testsetData,
    ...props
}: AddToTestsetButtonProps) => {
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useAtom(isAddToTestsetDrawerOpenAtom)
    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsTestsetDrawerOpen(true)
                        },
                    },
                )
            ) : (
                <EnhancedButton
                    label={label}
                    icon={icon && <Database size={14} />}
                    onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setIsTestsetDrawerOpen(true)
                    }}
                    {...props}
                />
            )}

            <TestsetDrawer
                open={isTestsetDrawerOpen}
                data={testsetData}
                showSelectedSpanText={false}
                onClose={() => {
                    setIsTestsetDrawerOpen(false)
                }}
            />
        </>
    )
}

export default AddToTestsetButton
