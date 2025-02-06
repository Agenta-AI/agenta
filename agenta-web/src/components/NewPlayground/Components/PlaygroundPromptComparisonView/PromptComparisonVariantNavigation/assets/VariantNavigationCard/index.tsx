import {memo, useCallback, useMemo} from "react"

import {Button, Tag, Typography} from "antd"
import {PlusCircle, Timer, X} from "@phosphor-icons/react"
import {useSortable} from "@dnd-kit/sortable"
import {CSS} from "@dnd-kit/utilities"
import clsx from "clsx"

import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import Version from "../../../../../assets/Version"
import usePlayground from "../../../../../hooks/usePlayground"

import {useStyles} from "./styles"

import type {VariantNavigationCardProps} from "./types"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {getResponseLazy} from "@/components/NewPlayground/state"

const {Text} = Typography

const VariantNavigationCard = ({
    variantId,
    id,
    className,
    handleScrollClick,
}: VariantNavigationCardProps) => {
    const classes = useStyles()
    const {toggleVariantDisplay, variant, resultHashes} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                // TODO: add a conditional to handle completion and chat
                const variantRuns = state.generationData.inputs.value.map(
                    (item) => item.__runs?.[variantId],
                )
                const resultHashes = variantRuns.map((result) => result?.__result)
                return {resultHashes}
            },
            [variantId],
        ),
    })
    const results = useMemo(() => {
        return resultHashes.map((hash) => {
            return getResponseLazy(hash)
        })
    }, [resultHashes])
    const {attributes, listeners, setNodeRef, transform, transition, isDragging, active} =
        useSortable({id})
    const style = useMemo(
        () => ({
            transform: CSS.Transform.toString(transform),
            transition,
        }),
        [transform, transition],
    )

    // From total rows calculating average costs, tokens, and durations of a variant in each run
    const calculateAverageLatency = useCallback(
        (type: "tokens" | "duration" | "costs") => {
            if (!results || results.length === 0) return null

            const total = results.reduce((sum, item) => {
                const value = Number(
                    item?.response?.tree?.nodes?.[0]?.metrics?.acc?.[type]?.total || 0,
                )
                return sum + value
            }, 0)

            const average = total

            switch (type) {
                case "duration":
                    return formatLatency(average / 1000)
                case "costs":
                    return formatCurrency(average)
                case "tokens":
                    return formatTokenUsage(average)
                default:
                    return null
            }
        },
        [results],
    )

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleScrollClick()
            }}
            className={clsx(
                "cursor-move",
                {
                    "z-[10]": isDragging,
                },
                className,
            )}
        >
            <div
                className={clsx(
                    "p-2 rounded-lg w-full flex flex-col gap-3",
                    "translate-x-0 translate-y-0 skew-x-0 skew-y-0 rotate-0",
                    "transition-all duration-200 ease-in-out",
                    "opacity-100 *:!select-none",
                    classes.card,
                    {
                        "shadow-xl [&_>_div]:scale-[1.01]": isDragging,
                        "opacity-50": active && !isDragging,
                    },
                )}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        <Text>{variant?.variantName}</Text>
                        <Version revision={variant?.revision as number} />
                    </div>
                    <Button
                        icon={<X size={14} />}
                        type="text"
                        className="relative z-[2]"
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleVariantDisplay?.(variantId, false)
                        }}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <Text>Average Latency</Text>
                    <Tag color="default" bordered={false} className="flex items-center gap-1">
                        <Timer size={14} /> {calculateAverageLatency("duration")}
                    </Tag>
                </div>
                <div className="flex items-center justify-between">
                    <Text>Average Cost</Text>
                    <Tag color="default" bordered={false} className="flex items-center gap-1">
                        <PlusCircle size={14} /> {calculateAverageLatency("tokens")} /{" "}
                        {calculateAverageLatency("costs")}
                    </Tag>
                </div>
            </div>
        </div>
    )
}

export default memo(VariantNavigationCard)
