import {useCallback} from "react"

import clsx from "clsx"
import {DndContext, closestCenter, PointerSensor, useSensor, useSensors} from "@dnd-kit/core"
import {arrayMove, SortableContext, verticalListSortingStrategy} from "@dnd-kit/sortable"
import {restrictToParentElement} from "@dnd-kit/modifiers"
import {Typography} from "antd"
import usePlayground from "../../../hooks/usePlayground"

import VariantNavigationCard from "./assets/VariantNavigationCard"
import type {PromptComparisonVariantNavigationProps} from "./types"

const PromptComparisonVariantNavigation = ({
    className,
    handleScroll,
    ...props
}: PromptComparisonVariantNavigationProps) => {
    const {displayedVariants, setDisplayedVariants} = usePlayground()

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
                const oldIndex = displayedVariants!.indexOf(active.id)
                const newIndex = displayedVariants!.indexOf(over.id)

                const newArray = arrayMove(displayedVariants!, oldIndex, newIndex)
                setDisplayedVariants?.(newArray)
            }
        },
        [displayedVariants],
    )

    return (
        <div {...props} className={clsx([className])}>
            <div className="w-full h-[48px] flex items-center px-2 sticky top-0 z-10 bg-white border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
                <Typography.Text>Variants</Typography.Text>
            </div>

            <div className="flex flex-col gap-2 p-2">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                    modifiers={[restrictToParentElement]}
                >
                    <SortableContext
                        items={displayedVariants!}
                        strategy={verticalListSortingStrategy}
                    >
                        {displayedVariants?.map((variantId, idx) => {
                            return (
                                <VariantNavigationCard
                                    key={variantId}
                                    id={variantId}
                                    variantId={variantId}
                                    handleScrollClick={() => handleScroll(idx)}
                                />
                            )
                        })}
                    </SortableContext>
                </DndContext>
            </div>
        </div>
    )
}

export default PromptComparisonVariantNavigation
