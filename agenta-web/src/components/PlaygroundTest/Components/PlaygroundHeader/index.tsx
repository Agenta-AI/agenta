import {memo, useCallback, useMemo, useState, useTransition} from "react"
import {Typography, message} from "antd"
import clsx from "clsx"
import AddButton from "./../../assets/AddButton"
import NewVariantModal from "../NewVariantModal"
import usePlayground from "../../hooks/usePlayground"
import type {BaseContainerProps} from "../types"

/**
 * PlaygroundHeader manages the creation of new variants in the playground.
 * 
 * This component provides UI for adding new variants based on existing templates
 * and handles the state management for the variant creation modal.
 * 
 * @component
 * @example
 * ```tsx
 * import { PlaygroundHeader } from './PlaygroundHeader'
 * 
 * function App() {
 *   return <PlaygroundHeader />
 * }
 * ```
 */
const PlaygroundHeader: React.FC<BaseContainerProps> = ({ className, ...divProps }) => {
    const [displayModal, _setDisplayModal] = useState(false)
    const [newVariantName, setNewVariantName] = useState("")
    const [baseVariantName, setBaseVariantName] = useState("")
    const [, contextHolder] = message.useMessage()
    const [, startTransition] = useTransition()

    // Wrap modal state updates in transitions to prevent UI blocking
    const setDisplayModal = useCallback((value: boolean) => {
        startTransition(() => {
            _setDisplayModal(value)
        })
    }, [])

    const {addVariant, variants} = usePlayground()

    // Track the selected base variant for creating new variants
    const baseVariant = useMemo(() => {
        return (variants || []).find((variant) => variant.variantName === baseVariantName)
    }, [variants, baseVariantName])

    // Validate and create new variants based on selected template
    const addNewVariant = useCallback(() => {
        if (!baseVariant) {
            message.error("Template variant not found. Please choose a valid variant.")
            return
        }

        addVariant?.({
            baseVariantName: baseVariant.variantName,
            newVariantName: newVariantName,
        })
    }, [baseVariant, newVariantName, addVariant])

    // Only render if variants are available
    return !!variants ? (
        <>
            {contextHolder}
            <div 
                className={clsx(
                    "flex items-center gap-4 px-2.5 py-2",
                    className
                )}
                {...divProps}
            >
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Playground
                </Typography>
                <AddButton
                    label={"Variant"}
                    onClick={() => {
                        setDisplayModal(true)
                    }}
                />
                <NewVariantModal
                    variants={variants}
                    isModalOpen={displayModal}
                    setIsModalOpen={setDisplayModal}
                    newVariantName={newVariantName}
                    setNewVariantName={setNewVariantName}
                    addTab={addNewVariant}
                    setTemplateVariantName={setBaseVariantName}
                />
            </div>
        </>
    ) : null
}

export default memo(PlaygroundHeader)
