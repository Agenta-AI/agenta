import PlaygroundPromptTool from "../PlaygroundPromptTool"
import AddButton from "../../assets/AddButton"

const PlaygroundPromptTools = () => {
    return (
        <section className="flex flex-col items-start gap-4">
            <PlaygroundPromptTool />
            <AddButton label="Tool" />
        </section>
    )
}

export default PlaygroundPromptTools
