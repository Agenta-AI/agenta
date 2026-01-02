import ToolCallView from "@/oss/components/Playground/Components/ToolCallView"
import {deriveToolViewModelFromResult} from "@/oss/state/newPlayground/chat/parsers"
import dynamic from "next/dynamic"
import {useMemo} from "react"
import SharedEditor from "../../../SharedEditor"
import RepetitionNavigation from "../RepetitionNavigation"


const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})

interface Props {
    result: any
    repetitionProps?: {
        current: number
        total: number
        onNext: () => void
        onPrev: () => void
    }
}

export default function GenerationResponsePanel({result, repetitionProps}: Props) {
    const {toolData, isJSON, displayValue} = useMemo(
        () => deriveToolViewModelFromResult(result),
        [result],
    )

    const footerNode = (
        <div className="w-full flex justify-between items-center mt-2 gap-2">
            <GenerationResultUtils result={result} />
            {repetitionProps && <RepetitionNavigation {...repetitionProps} />}
        </div>
    )

    if (toolData) {
        return <ToolCallView resultData={toolData} className="w-full" footer={footerNode} />
    }

    return (
        <SharedEditor
            initialValue={displayValue}
            editorType="borderless"
            state="filled"
            readOnly
            editorProps={{codeOnly: isJSON}}
            disabled
            className="w-full"
            editorClassName="min-h-4 [&_p:first-child]:!mt-0"
            footer={footerNode}
            handleChange={() => undefined}
        />
    )
}
