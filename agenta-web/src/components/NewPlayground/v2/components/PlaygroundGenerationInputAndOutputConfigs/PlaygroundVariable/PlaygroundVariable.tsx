import {Input, Typography} from "antd"
import clsx from "clsx"
import {PlaygroundVariableProps} from "./types"
import GenerationVariableOptions from "@/components/NewPlayground/Components/PlaygroundGenerations/assets/GenerationVariableOptions"

const PlaygroundVariable: React.FC<PlaygroundVariableProps> = ({
    className,
    variables,
    isMenu = true,
}) => {
    return (
        <div className={clsx("w-full flex items-start justify-start gap-4 group/item", className)}>
            <Typography.Text className="text-nowrap w-[100px]">Variables</Typography.Text>
            <div className="w-[80%] relative">
                <div className="absolute z-40 top-2 left-2.5 flex items-center gap-2">
                    {variables.map((variable) => (
                        <Typography.Text className="text-blue-600" key={variable}>
                            {variable},
                        </Typography.Text>
                    ))}
                </div>
                <Input.TextArea placeholder="Enter value" className="w-full pt-9" />
            </div>

            {isMenu && (
                <GenerationVariableOptions
                    variantId=""
                    rowId=""
                    className="invisible group-hover/item:visible"
                />
            )}
        </div>
    )
}

export default PlaygroundVariable
