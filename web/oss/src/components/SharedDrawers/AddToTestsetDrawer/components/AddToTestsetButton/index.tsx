import {cloneElement, isValidElement, ReactElement, useCallback} from "react"

import {Database} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"

import {closeDrawerAtom, isDrawerOpenAtom, openDrawerWithSpanIdsAtom} from "../../atoms/drawerState"
import TestsetDrawer from "../../TestsetDrawer"

import {AddToTestsetButtonProps} from "./types"

const AddToTestsetButton = ({
    label,
    icon = true,
    children,
    spanIds,
    testsetData,
    ...props
}: AddToTestsetButtonProps) => {
    const [isDrawerOpen, setIsDrawerOpen] = useAtom(isDrawerOpenAtom)
    const openDrawerWithSpanIds = useSetAtom(openDrawerWithSpanIdsAtom)
    const closeDrawer = useSetAtom(closeDrawerAtom)

    // Handle click - prefer spanIds over testsetData
    const handleClick = useCallback(
        (e?: React.MouseEvent) => {
            e?.preventDefault()
            e?.stopPropagation()

            if (spanIds && spanIds.length > 0) {
                // Preferred: open drawer with span IDs (fetches from entity cache)
                openDrawerWithSpanIds(spanIds)
            } else {
                // Legacy: just open drawer, data will be passed via props
                setIsDrawerOpen(true)
            }
        },
        [spanIds, openDrawerWithSpanIds, setIsDrawerOpen],
    )

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: handleClick,
                    },
                )
            ) : (
                <EnhancedButton
                    label={label}
                    icon={icon && <Database size={14} />}
                    onClick={handleClick}
                    {...props}
                />
            )}

            <TestsetDrawer
                open={isDrawerOpen}
                data={testsetData}
                showSelectedSpanText={false}
                onClose={() => {
                    closeDrawer()
                }}
            />
        </>
    )
}

export default AddToTestsetButton
