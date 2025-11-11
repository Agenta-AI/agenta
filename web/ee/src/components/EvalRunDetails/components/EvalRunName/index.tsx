import {memo} from "react"

import {Typography} from "antd"

import {EvalRunProps} from "../../assets/types"
import RenameEvalButton from "../Modals/RenameEvalModal/assets/RenameEvalButton"

const EvalRunName = ({id, name, description}: EvalRunProps) => {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 group relative">
                <Typography.Title level={4} className="!font-medium !m-0">
                    {name}
                </Typography.Title>
                <RenameEvalButton
                    id={id}
                    name={name}
                    description={description}
                    type="text"
                    size="small"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    tabIndex={0}
                    aria-label="Edit run name and description"
                    style={{padding: 0, minWidth: 24, height: 24, lineHeight: 1}}
                />
            </div>
            {description && (
                <Typography.Paragraph
                    type="secondary"
                    className="!m-0"
                    ellipsis={{
                        rows: 3,
                        tooltip: {
                            title: description,
                            overlayStyle: {maxWidth: 500},
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
