import PlaygroundVariables from "../../PlaygroundVariables"
import {Button} from "antd"
import {Plus} from "@phosphor-icons/react"

const PlaygroundGenerationVariableConfig = () => {
    return (
        <section className="p-4">
            <PlaygroundVariables />

            <div className="flex items-center gap-2">
                <Button icon={<Plus size={14} />}>Input</Button>
                <Button>Add all to test set</Button>
            </div>
        </section>
    )
}

export default PlaygroundGenerationVariableConfig
