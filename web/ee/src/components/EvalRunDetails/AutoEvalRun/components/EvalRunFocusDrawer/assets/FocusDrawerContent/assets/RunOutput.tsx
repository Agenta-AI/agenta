import clsx from "clsx"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"

const RunOutput = ({
    runId,
    scenarioId,
    stepKey,
    showComparisons,
}: {
    runId: string
    scenarioId?: string
    stepKey?: string
    showComparisons?: boolean
}) => {
    const {
        value,
        messageNodes: nodes,
        hasError: err,
    } = useInvocationResult({
        scenarioId,
        stepKey,
        editorType: "simple",
        viewType: "single",
        runId,
    })
    return (
        <div
            className={clsx(
                showComparisons
                    ? "!w-[480px] shrink-0 px-3 border-0 border-r border-solid border-white"
                    : "w-full",
                "min-h-0",
            )}
        >
            {nodes ? (
                nodes
            ) : (
                <SimpleSharedEditor
                    key={`output-${scenarioId || runId}`}
                    handleChange={() => {}}
                    initialValue={
                        !!value && typeof value !== "string" ? JSON.stringify(value) : value
                    }
                    headerName="Output"
                    editorType="borderless"
                    state="readOnly"
                    disabled
                    readOnly
                    editorClassName="!text-xs"
                    error={err}
                    placeholder="N/A"
                    className="!w-[97.5%]"
                />
            )}
        </div>
    )
}

export default RunOutput
