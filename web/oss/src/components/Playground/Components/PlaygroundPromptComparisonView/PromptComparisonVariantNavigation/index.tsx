import {useCallback} from "react"

import {DndContext, closestCenter, PointerSensor, useSensor, useSensors} from "@dnd-kit/core"
import {restrictToParentElement} from "@dnd-kit/modifiers"
import {arrayMove, SortableContext, verticalListSortingStrategy} from "@dnd-kit/sortable"
import {Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {usePlaygroundLayout} from "../../../hooks/usePlaygroundLayout"
import {selectedVariantsAtom, updateUrlRevisionsAtom} from "../../../state/atoms"

import VariantNavigationCard from "./assets/VariantNavigationCard"
import type {PromptComparisonVariantNavigationProps} from "./types"

const PromptComparisonVariantNavigation = ({
    className,
    handleScroll,
    ...props
}: PromptComparisonVariantNavigationProps) => {
    const {displayedVariants} = usePlaygroundLayout()
    const selectedVariants = useAtomValue(selectedVariantsAtom)
    const setSelectedVariants = useSetAtom(selectedVariantsAtom)
    const updateUrlRevisions = useSetAtom(updateUrlRevisionsAtom)

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                delay: 100,
                tolerance: 5,
                distance: 5,
            },
        }),
    )

    const handleDragEnd = useCallback(
        (event: any) => {
            const {active, over} = event

            if (over?.id && active.id && active.id !== over?.id) {
                // Get current revision IDs from selectedVariants (which is a string array)
                const currentRevisionIds = selectedVariants || []

                const oldIndex = currentRevisionIds.indexOf(active.id)
                const newIndex = currentRevisionIds.indexOf(over.id)

                if (oldIndex !== -1 && newIndex !== -1) {
                    // Reorder the array
                    const reorderedRevisions = arrayMove(currentRevisionIds, oldIndex, newIndex)

                    // Update both selectedVariantsAtom and urlRevisionsAtom to ensure display sync
                    setSelectedVariants(reorderedRevisions)
                    updateUrlRevisions(reorderedRevisions)
                }
            }
        },
        [selectedVariants, setSelectedVariants, updateUrlRevisions],
    )

    return (
        <div {...props} className={clsx([className, "z-[20]"])}>
            <div className="w-full h-[48px] flex items-center px-2 sticky top-0 z-10 bg-white border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
                <Typography.Text>Variants</Typography.Text>
            </div>

            <div className="flex flex-col gap-3 p-3">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                    modifiers={[restrictToParentElement]}
                >
                    <SortableContext
                        items={displayedVariants || []}
                        strategy={verticalListSortingStrategy}
                    >
                        {displayedVariants?.map((variantId, idx) => (
                            <VariantNavigationCard
                                key={variantId}
                                id={variantId}
                                revisionId={variantId}
                                handleScrollClick={() => handleScroll(idx)}
                            />
                        ))}
                    </SortableContext>
                </DndContext>
            </div>
        </div>
    )
}

export default PromptComparisonVariantNavigation
