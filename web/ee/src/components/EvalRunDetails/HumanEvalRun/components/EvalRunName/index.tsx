import {memo} from "react"

import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {urlStateAtom} from "../../../state/urlState"
import {EvalRunProps} from "../../assets/types"
import RenameEvalButton from "../Modals/RenameEvalModal/assets/RenameEvalButton"

const EvalRunName = (props: EvalRunProps) => {
    const {id, name, description, runId} = props || {}
    const urlState = useAtomValue(urlStateAtom)

    // Check if we're in comparison mode
    const isComparisonMode = Boolean(urlState.compare && urlState.compare.length > 0)

    if (isComparisonMode) {
        return (
            <div className="mb-4 w-full">
                <div className="flex items-center justify-between mb-2 w-full">
                    <div className="flex items-center gap-2">
                        <Typography.Title level={4} className="!mb-0 !mt-0">
                            Evaluation Run Comparison
                        </Typography.Title>
                    </div>
                </div>
                {description && (
                    <Typography.Text type="secondary" ellipsis={{tooltip: description}}>
                        {description}
                    </Typography.Text>
                )}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 group relative">
                    <Typography.Title level={4} className="!font-medium !m-0">
                        {name}
                    </Typography.Title>
                    <RenameEvalButton
                        id={id}
                        name={name}
                        description={description}
                        runId={runId}
                        type="text"
                        size="small"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        tabIndex={0}
                        aria-label="Edit run name and description"
                        style={{padding: 0, minWidth: 24, height: 24, lineHeight: 1}}
                    />
                </div>
            </div>
            {description && (
                <Typography.Paragraph
                    type="secondary"
                    className="!m-0"
                    ellipsis={{
                        rows: 3,
                        tooltip: {
                            title: description,
                            styles: {
                                root: {maxWidth: 500},
                            },
                        },
                    }}
                >
                    {description}
                </Typography.Paragraph>
            )}
        </div>
    )
}

export default memo(EvalRunName)
