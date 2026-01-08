import {useMemo} from "react"

import {ArrowsOutLineHorizontal} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import ToolCallView from "@/oss/components/Playground/Components/ToolCallView"
import {deriveToolViewModelFromResult} from "@/oss/state/newPlayground/chat/parsers"
import {openPlaygroundFocusDrawerAtom} from "@/oss/state/playgroundFocusDrawerAtom"

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
    const openFocusDrawer = useSetAtom(openPlaygroundFocusDrawerAtom)
    const {toolData, isJSON, displayValue} = useMemo(
        () => deriveToolViewModelFromResult(result),
        [result],
    )

    const footerNode = (
        <div className="w-full flex justify-between items-center mt-2 gap-2">
            <GenerationResultUtils result={result} />
        </div>
    )

    if (toolData) {
        return <ToolCallView resultData={toolData} className="w-full" footer={footerNode} />
    }

    return (
        <div>
            {repetitionProps && (
                <div className="flex gap-2 justify-between items-center mb-1">
                    <Typography.Text type="secondary" className="text-[10px] text-nowrap">
                        Total repetitions: {repetitionProps.total}
                    </Typography.Text>

                    <div className="flex gap-2 items-center">
                        <EnhancedButton
                            icon={<ArrowsOutLineHorizontal size={12} />}
                            size="small"
                            className="!w-5 !h-5"
                            onClick={() => openFocusDrawer({rowId, variantId})}
                            tooltipProps={{title: "View all repetitions"}}
                        />
                        <RepetitionNavigation {...repetitionProps} />
                    </div>
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
