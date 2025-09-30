import {useMemo} from "react"

import dynamic from "next/dynamic"

import ToolCallView from "@/oss/components/Playground/Components/ToolCallView"
import {deriveToolViewModelFromResult} from "@/oss/state/newPlayground/chat/parsers"

import SharedEditor from "../../../SharedEditor"

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})

interface Props {
    result: any
}

export default function GenerationResponsePanel({result}: Props) {
    const {toolData, isJSON, displayValue} = useMemo(
        () => deriveToolViewModelFromResult(result),
        [result],
    )

    if (toolData) {
        return (
            <ToolCallView
                resultData={toolData}
                className="w-full"
                footer={<GenerationResultUtils className="mt-2" result={result} />}
            />
        )
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
            footer={<GenerationResultUtils className="mt-2" result={result} />}
            handleChange={() => undefined}
        />
    )
}
