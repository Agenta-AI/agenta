import {Select} from "antd"
import {PlaygroundGenerationChatSelectOptionsProps} from "./types"

const PlaygroundGenerationChatSelectOptions: React.FC<
    PlaygroundGenerationChatSelectOptionsProps
> = ({...props}) => {
    const options = [
        {label: "USER", value: "user"},
        {label: "SYSTEM", value: "system"},
    ]
    return <Select defaultValue="system" style={{width: 100}} options={options} {...props} />
}

export default PlaygroundGenerationChatSelectOptions
