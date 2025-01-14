import {useMemo} from "react"
import {Collapse} from "antd"
import PlaygroundPromptTools from "../PlaygroundPromptTools"

const PlaygroundPromptToolsConfig = () => {
    const items = useMemo(
        () => [
            {
                key: "1",
                classNames: {
                    header: "[&.ant-collapse-header]:!px-2.5",
                },
                label: "Tools",
                children: <PlaygroundPromptTools />,
            },
        ],
        [],
    )
    return <Collapse ghost defaultActiveKey={["1"]} bordered={false} items={items} />
}

export default PlaygroundPromptToolsConfig
