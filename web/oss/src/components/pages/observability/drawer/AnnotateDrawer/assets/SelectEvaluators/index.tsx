import {useCallback, useMemo, useState} from "react"

import {Checkbox, CheckboxChangeEvent, Input, Skeleton, Tooltip, Typography} from "antd"
import clsx from "clsx"

import useEvaluators from "@/oss/lib/hooks/useEvaluators"

import {SelectEvaluatorsProps} from "../types"

const SelectEvaluators = ({
    selectedEvaluators,
    setSelectedEvaluators,
    annEvalSlugs,
    setTempSelectedEvaluators,
}: SelectEvaluatorsProps) => {
    const [search, setSearch] = useState("")
    const {data: evaluators, isLoading} = useEvaluators()

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
        [selectedEvaluators, evaluators, setTempSelectedEvaluators],
    )

    return (
        <section className="h-full flex flex-col gap-2">
            <Input
                placeholder="Search"
                variant="borderless"
                className="border-0 border-b border-solid border-[#0517290F] rounded-none py-2"
                onChange={(e) => setSearch(e.target.value)}
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
                    <Tooltip title={evaluator.description} key={evaluator.slug} placement="left">
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
                            <span className="capitalize w-[70%] truncate">{evaluator.name}</span>
                            <span className="text-[#758391] shrink-0">Metric</span>
                        </Checkbox>
                    </Tooltip>
                ))}
            </div>

            {filteredEvals?.length === 0 && (
                <div className="h-full flex items-center justify-center">
                    <Typography.Text type="secondary">
                        {search.length > 0
                            ? "No results found"
                            : "There are no available evaluators"}
                    </Typography.Text>
                </div>
            )}
        </section>
    )
}

export default SelectEvaluators
