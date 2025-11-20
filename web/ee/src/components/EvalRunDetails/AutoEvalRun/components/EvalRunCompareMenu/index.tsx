import {memo, useCallback, useMemo, useState} from "react"
import {Button, ButtonProps, Input, Popover, PopoverProps, Typography, Tag} from "antd"
import useFocusInput from "@/oss/hooks/useFocusInput"
import {Check, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {evaluationRunStateAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {EvaluationType} from "@/oss/lib/enums"
import usePreviewEvaluations from "@/oss/lib/hooks/usePreviewEvaluations"

const EvalRunCompareMenu = ({
    popoverProps,
    buttonProps,
}: {
    popoverProps?: PopoverProps
    buttonProps?: ButtonProps
}) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const {inputRef} = useFocusInput({isOpen: isMenuOpen})

    const {runs} = usePreviewEvaluations({
        skip: false,
        types: [EvaluationType.auto_exact_match],
    })

    // atoms
    const evaluation = useAtomValue(evaluationRunStateAtom)
    const enrichedRun = evaluation?.enrichedRun

    const onSelectEvaluation = useCallback((evaluation: string) => {}, [runs])

    const evaluations = useMemo(() => {
        const matchedTestsetEvals = runs.filter(
            (run) => run?.testsets?.[0]?.id === enrichedRun?.testsets?.[0]?.id,
        )
        const evals = matchedTestsetEvals.filter((run) => run?.id !== enrichedRun?.id)

        return evals
    }, [runs])

    const filteredEvals = useMemo(() => {
        if (searchTerm.trim().length > 0) {
            return evaluations.filter((e) =>
                e?.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }

        return evaluations
    }, [searchTerm, evaluations])

    return (
        <Popover
            open={isMenuOpen}
            onOpenChange={setIsMenuOpen}
            classNames={{body: "!px-0 !py-2"}}
            trigger={["click"]}
            arrow={false}
            content={
                <section className="flex flex-col gap-2 w-[400px]">
                    <div className="flex flex-col gap-0.5 border-0 border-b border-solid border-[#EAEFF5]">
                        <div className="flex items-center gap-2 justify-between px-2">
                            <Typography.Text className="font-medium">
                                Add evaluations using testset:
                            </Typography.Text>
                            <Tag bordered={false} className="bg-[#0517290F]">
                                {enrichedRun?.testsets?.[0]?.name}
                            </Tag>
                        </div>

                        <Input
                            ref={inputRef}
                            placeholder="Search"
                            variant="borderless"
                            className="rounded-none py-2"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {filteredEvals?.length > 0 ? (
                        <div className="flex flex-col gap-0.5 px-1 max-h-[220px] overflow-y-scroll">
                            {filteredEvals?.map((evaluation) => (
                                <div
                                    key={evaluation.id}
                                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-[#eaeff550] duration-200 cursor-pointer"
                                    onClick={() => onSelectEvaluation(evaluation)}
                                >
                                    <Typography.Text>{evaluation.name}</Typography.Text>{" "}
                                    {/* {evaluation === "Evaluation 1" && <Check size={14} />} */}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="w-full flex items-center justify-center h-[100px]">
                            <Typography.Text type="secondary">No evaluations found</Typography.Text>
                        </div>
                    )}
                </section>
            }
            {...popoverProps}
        >
            <Button icon={<Plus size={14} />} {...buttonProps}>
                Compare
            </Button>
        </Popover>
    )
}

export default memo(EvalRunCompareMenu)
