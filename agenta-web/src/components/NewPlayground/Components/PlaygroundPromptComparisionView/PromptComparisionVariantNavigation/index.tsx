import {useState} from "react"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core"
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import VariantNavigationCard from "./assets/VariantNavigationCard"
import {Typography} from "antd"
import PlaygroundCreateNewVariant from "../../Menus/PlaygroundCreateNewVariant"

const PromptComparisionVariantNavigation = () => {
    const [items, setItems] = useState([1, 2, 3])
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    )

    function handleDragEnd(event: any) {
        const {active, over} = event

        if (over?.id && active.id && active.id !== over?.id) {
            setItems((items) => {
                const oldIndex = items.indexOf(active.id)
                const newIndex = items.indexOf(over.id)

                return arrayMove(items, oldIndex, newIndex)
            })
        }
    }

    return (
        <>
            <div className="[&::-webkit-scrollbar]:w-0 w-[400px] h-full overflow-y-auto">
                <div className="w-full flex items-center justify-between p-2 !border-b border-gray-300 sticky top-0 z-[1] bg-white">
                    <Typography.Text>Varaints</Typography.Text>
                    <PlaygroundCreateNewVariant />
                </div>

                <div className="flex flex-col gap-2 p-2">
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext items={items} strategy={verticalListSortingStrategy}>
                            {items.map((id) => (
                                <VariantNavigationCard key={id} id={id} />
                            ))}
                        </SortableContext>
                    </DndContext>
                </div>
            </div>
        </>
    )
}

export default PromptComparisionVariantNavigation
