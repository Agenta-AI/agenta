import {Button} from "antd"
import {Plus} from "@phosphor-icons/react"
import PlaygroundGenerationChat from "./PlaygroundGenerationChat"
import PlaygroundGenerationCompletion from "./PlaygroundGenerationCompletion"

const PlaygroundGenerationVariableConfig = () => {
    return (
        <section className="p-4">
            <PlaygroundGenerationCompletion />

            <div className="flex items-center gap-2">
                <Button icon={<Plus size={14} />}>Input</Button>
                <Button>Add all to test set</Button>
            </div>
        </section>
    )
}

export default PlaygroundGenerationVariableConfig
