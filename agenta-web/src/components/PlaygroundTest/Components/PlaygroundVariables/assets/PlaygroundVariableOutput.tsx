import {TreeView, Timer, PlusCircle, CheckCircle} from "@phosphor-icons/react"
import {Button, Tag, Typography, Space} from "antd"
import {PlaygroundVariableOutputProps} from "./types"
import ResultTag from "@/components/ResultTag/ResultTag"

const {Text} = Typography

const PlaygroundVariableOutput: React.FC<PlaygroundVariableOutputProps> = ({isOutput}) => {
    const status = "success"
    const time_end = "0.0453s"
    const cost = "79 / $0.0053"

    if (isOutput === "error") {
        return <Text type="danger">Error generating output</Text>
    }

    if (isOutput === "generated") {
        return (
            <div className="flex flex-col gap-3">
                <Text type="success">Output generated</Text>

                <div className="flex items-center gap-1">
                    <Button icon={<TreeView size={14} />} />
                    <Tag color="green" bordered={false} className="flex items-center gap-1">
                        <CheckCircle size={14} /> {status}
                    </Tag>
                    <Tag color="default" bordered={false} className="flex items-center gap-1">
                        <Timer size={14} /> {time_end}
                    </Tag>

                    <ResultTag
                        color="default"
                        bordered={false}
                        value1={
                            <div className="flex items-center gap-1">
                                <PlusCircle size={14} /> {cost}
                            </div>
                        }
                        popoverContent={
                            <Space direction="vertical">
                                <Space>
                                    <div>{cost}</div>
                                    <div>Prompt tokens</div>
                                </Space>
                                <Space>
                                    <div>{cost}</div>
                                    <div>Completion tokens</div>
                                </Space>
                            </Space>
                        }
                    />
                </div>
            </div>
        )
    }

    return <Text type="secondary">Click to generate output</Text>
}

export default PlaygroundVariableOutput
