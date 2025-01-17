import {useCallback, useMemo} from "react"
import {Button, Tag, Typography} from "antd"
import {PlusCircle, Timer, X} from "@phosphor-icons/react"
import {useStyles} from "./styles"
import clsx from "clsx"
import {useSortable} from "@dnd-kit/sortable"
import {CSS} from "@dnd-kit/utilities"
import Version from "@/components/NewPlayground/assets/Version"
import {VariantNavigationCardProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

const {Text} = Typography

const VariantNavigationCard = ({variantId, id, className}: VariantNavigationCardProps) => {
    const classes = useStyles()
    const {toggleVariantDisplay} = usePlayground()
    const {attributes, listeners, setNodeRef, transform, transition} = useSortable({id})

    const time_end = "0.0453s"
    const cost = "79 / $0.0053"

    const style = useMemo(
        () => ({
            transform: CSS.Transform.toString(transform),
            transition,
        }),
        [],
    )

    const onRemoveVariant = (variantId: string) => {
        toggleVariantDisplay?.(variantId, false)
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={clsx(
                "w-full flex flex-col gap-3 cursor-move *:select-none",
                className,
                classes.card,
            )}
        >
            <div className="flex items-center justify-between">
                <Text>Variant A</Text>
                <Button
                    icon={<X size={14} />}
                    type="text"
                    onClick={() => onRemoveVariant(variantId)}
                />
            </div>
            <div className="flex items-center justify-between">
                <Text>Name</Text>
                <div className="flex items-center gap-1">
                    <Text>variant-name</Text>
                    <Version revision={2} />
                </div>
            </div>
            <div className="flex items-center justify-between">
                <Text>Average Latency</Text>
                <Tag color="default" bordered={false} className="flex items-center gap-1">
                    <Timer size={14} /> {time_end}
                </Tag>
            </div>
            <div className="flex items-center justify-between">
                <Text>Average Cost</Text>
                <Tag color="default" bordered={false} className="flex items-center gap-1">
                    <PlusCircle size={14} /> {cost}
                </Tag>
            </div>
        </div>
    )
}

export default VariantNavigationCard
