import {memo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import EvalRunScenariosViewSelector from "../../../components/EvalRunScenariosViewSelector"
import {runViewTypeAtom} from "../../../state/urlState"

const EvalRunHeader = ({className, name, id}: {className?: string; name: string; id: string}) => {
    const viewType = useAtomValue(runViewTypeAtom)
    return (
        <div
            className={clsx([
                "flex items-center justify-between gap-4 py-2 px-6 sticky top-0 z-[11] bg-white",
                {"border-0 border-b border-solid border-[#0517290F]": viewType === "overview"},
                className,
            ])}
        >
            <EvalRunScenariosViewSelector />
        </div>
    )
}

export default memo(EvalRunHeader)
