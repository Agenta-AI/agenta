import {memo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import {useRunId} from "@/oss/contexts/RunIdContext"

import EvalRunScenariosViewSelector from "../../../components/EvalRunScenariosViewSelector"
import {runViewTypeAtom, urlStateAtom} from "../../../state/urlState"
import EvalRunCompareMenu from "../EvalRunCompareMenu"
import EvalRunSelectedEvaluations from "../EvalRunSelectedEvaluations"

const EvalRunHeader = ({className, name, id}: {className?: string; name: string; id: string}) => {
    const viewType = useAtomValue(runViewTypeAtom)
    const urlState = useAtomValue(urlStateAtom)
    const baseRunId = useRunId()
    return (
        <div
            className={clsx([
                "flex items-center justify-between gap-4 py-2 px-6 sticky top-0 z-[11] bg-white",
                {"border-0 border-b border-solid border-[#0517290F]": viewType === "overview"},
                className,
            ])}
        >
            <EvalRunScenariosViewSelector />

            <div className="flex items-center gap-4 min-w-0 max-w-full">
                <div className="min-w-0 flex-1">
                    {urlState.compare?.length > 0 && (
                        <EvalRunSelectedEvaluations
                            runIds={urlState.compare || []}
                            baseRunId={baseRunId!}
                        />
                    )}
                </div>

                <EvalRunCompareMenu
                    buttonProps={{type: "primary"}}
                    popoverProps={{placement: "bottomRight"}}
                />
            </div>
        </div>
    )
}

export default memo(EvalRunHeader)
