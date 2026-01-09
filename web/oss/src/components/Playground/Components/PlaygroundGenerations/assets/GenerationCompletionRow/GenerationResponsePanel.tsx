import {useMemo} from "react"

import {Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import ToolCallView from "@/oss/components/Playground/Components/ToolCallView"
import {isComparisonViewAtom} from "@/oss/components/Playground/state/atoms"
import {deriveToolViewModelFromResult} from "@/oss/state/newPlayground/chat/parsers"

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
    rowId: string
    variantId?: string
}

export default function GenerationResponsePanel({
    result,
    repetitionProps,
    rowId,
    variantId,
}: Props) {
    const {toolData, isJSON, displayValue} = useMemo(
        () => deriveToolViewModelFromResult(result),
        [result],
    )

    const footerNode = (
        <div className="w-full flex justify-between items-center mt-2 gap-2">
            <GenerationResultUtils result={result} />
        </div>
    )

    const isComparisonView = useAtomValue(isComparisonViewAtom)

    if (toolData) {
        return <ToolCallView resultData={toolData} className="w-full" footer={footerNode} />
    }

    return (
        <div>
            {repetitionProps && !isComparisonView && (
                <div className="flex gap-1 items-center mb-1">
                    <Typography.Text type="secondary" className="text-[10px] text-nowrap">
                        Total repeats
                    </Typography.Text>
                    <RepetitionNavigation {...repetitionProps} />
                </div>
            )}

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
        </div>
    )
}
