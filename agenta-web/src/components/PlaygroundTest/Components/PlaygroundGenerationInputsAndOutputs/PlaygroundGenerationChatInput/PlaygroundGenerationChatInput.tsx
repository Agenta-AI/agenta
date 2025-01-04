import {Input} from "antd"
import {PlaygroundGenerationChatInputProps} from "./types"

const PlaygroundGenerationChatInput: React.FC<PlaygroundGenerationChatInputProps> = ({
    ...props
}) => {
    return <Input placeholder="Type your message here" className="w-full border-none" {...props} />
}

export default PlaygroundGenerationChatInput
