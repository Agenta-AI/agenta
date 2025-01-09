import {Input, Typography} from "antd"
import clsx from "clsx"
import PlaygroundVariableMenu from "../PlaygroundVariableMenu/PlaygroundVariableMenu"
import {PlaygroundVariableProps} from "./types"

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

            {/**
             * TODO: FIX THIS WITH CORRECT PROP EXPECTATIONS
             * */}
            {isMenu && (
                <PlaygroundVariableMenu
                    className="invisible group-hover/item:visible"
                    variantId={""}
                    rowId={""}
                />
            )}
        </div>
    )
}

export default PlaygroundVariable
