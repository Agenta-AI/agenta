import {Play} from "@phosphor-icons/react"
import {Button, Divider} from "antd"
import PlaygroundVariableOutput from "../../PlaygroundVariables/PlaygroundGenerationOutput/PlaygroundVariableOutput"
import PlaygroundVariable from "../../PlaygroundVariables/PlaygroundVariable/PlaygroundVariable"

const PlaygroundGenerationCompletion = () => {
    const isOutput = "generated"
    const envVariables = ["country", "name", "emal"]

    return (
        <div className="flex flex-col gap-6">
            <PlaygroundVariable variables={envVariables} />

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

export default PlaygroundGenerationCompletion
