import {useCallback, useMemo, useState} from "react"

import {evaluatorsListQueryAtom, humanEvaluatorsListDataAtom} from "@agenta/entities/workflow"
import {Input} from "@agenta/primitive-ui/components/input"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {Checkbox, CheckboxChangeEvent, Skeleton} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {SelectEvaluatorsProps} from "../types"

const SelectEvaluators = ({
    selectedEvaluators,
    setSelectedEvaluators,
    annEvalSlugs,
    setTempSelectedEvaluators,
}: SelectEvaluatorsProps) => {
    const [search, setSearch] = useState("")
    const evaluators = useAtomValue(humanEvaluatorsListDataAtom)
    const {isPending: isLoading} = useAtomValue(evaluatorsListQueryAtom)

    const filteredEvals = useMemo(
        () =>
            evaluators?.filter((value) => value.name.toLowerCase().includes(search.toLowerCase())),
        [search, evaluators],
    )

    const handleCheckboxChange = useCallback(
        (e: CheckboxChangeEvent) => {
            if (selectedEvaluators.includes(e.target.value)) {
                setSelectedEvaluators((prev) => prev.filter((slug) => slug !== e.target.value))
                setTempSelectedEvaluators((prev) => prev.filter((slug) => slug !== e.target.value))
            } else {
                setSelectedEvaluators((prev) => {
                    const updated = [...prev, e.target.value]
                    // Sort according to evaluators order
                    return (
                        evaluators?.map((ev) => ev.slug).filter((slug) => updated.includes(slug)) ||
                        []
                    )
                })
            }
        },
        [selectedEvaluators, evaluators, setTempSelectedEvaluators, setSelectedEvaluators],
    )

    return (
        <section className="h-full flex flex-col gap-2">
            <Input
                placeholder="Search"
                onChange={(e) => setSearch(e.target.value)}
                className="border-0 border-b border-solid border-[var(--ag-c-0517290F)] rounded-none py-2 border-transparent bg-transparent shadow-none focus-visible:ring-0"
            />
            <div className="flex flex-col gap-3 py-1 px-2">
                <Skeleton
                    avatar={false}
                    active={true}
                    title={false}
                    className="[&_li]:!h-6 -mt-2"
                    paragraph={{rows: 10, width: "100%"}}
                    loading={isLoading}
                />

                {filteredEvals?.map((evaluator) => (
                    <Tooltip key={evaluator.slug}>
                        <TooltipTrigger
                            render={
                                <Checkbox
                                    value={evaluator.slug}
                                    onChange={handleCheckboxChange}
                                    checked={
                                        selectedEvaluators.includes(evaluator.slug) ||
                                        annEvalSlugs.includes(evaluator.slug)
                                    }
                                    disabled={annEvalSlugs.includes(evaluator.slug)}
                                    className={clsx(
                                        "flex items-center",
                                        "[&_.ant-checkbox-label]:w-[96%]",
                                        "[&_.ant-checkbox-label]:flex [&_.ant-checkbox-label]:items-center [&_.ant-checkbox-label]:justify-between",
                                    )}
                                >
                                    <span className="capitalize w-[70%] truncate">
                                        {evaluator.name}
                                    </span>
                                    <span className="text-[var(--ag-c-758391)] shrink-0">
                                        Metric
                                    </span>
                                </Checkbox>
                            }
                        />
                        <TooltipContent side="left">{evaluator.description}</TooltipContent>
                    </Tooltip>
                ))}
            </div>

            {filteredEvals?.length === 0 && (
                <div className="h-full flex items-center justify-center">
                    <span className="text-muted-foreground">
                        {search.length > 0
                            ? "No results found"
                            : "There are no available evaluators"}
                    </span>
                </div>
            )}
        </section>
    )
}

export default SelectEvaluators
