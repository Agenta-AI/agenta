import {Play} from "@phosphor-icons/react"
import {Button, Divider, Input, Typography} from "antd"
import PlaygroundVariableOutput from "./assets/PlaygroundVariableOutput"
import PlaygroundVariableMenu from "./assets/PlaygroundVariableMenu"

const {Text} = Typography

const PlaygroundVariables = () => {
    const isOutput = "generated"
    const envVariables = "country"

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
                <Text className="text-nowrap w-[100px]">Variables</Text>
                <div className="w-[80%] relative">
                    <div className="absolute z-40 top-2 left-2.5 flex items-center gap-2">
                        <Text className="text-blue-600">{envVariables}</Text>
                    </div>
                    <Input.TextArea placeholder="Enter value" className="w-full pt-9" />
                </div>

                <PlaygroundVariableMenu />
            </div>

            <div className="flex items-start justify-start gap-4">
                <div className="w-[100px]">
                    <Button icon={<Play size={14} />}>Run</Button>
                </div>

                <PlaygroundVariableOutput isOutput={isOutput} />
            </div>

            <div className="-mx-3">
                <Divider className="!my-2 !mx-0" />
            </div>
        </div>
    )
}

export default PlaygroundVariables
