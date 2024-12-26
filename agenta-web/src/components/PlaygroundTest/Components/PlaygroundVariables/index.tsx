import {
    DotsThreeVertical,
    MinusCircle,
    ArrowsOut,
    Play,
    TreeView,
    Timer,
    PlusCircle,
    CheckCircle,
} from "@phosphor-icons/react"
import {Button, Divider, Input, Tag, Typography} from "antd"

const {Text} = Typography

type Output = "empty" | "error" | "generated"

const PlaygroundVariables = () => {
    const isOutput: Output = "empty"
    const envVariables = "country"
    const status = "success"
    const time_end = "0.0453s"
    const cost = "79 / $0.0053"

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

                <div className="flex items-center gap-1">
                    <Button icon={<ArrowsOut size={14} />} type="text" />
                    <Button icon={<MinusCircle size={14} />} type="text" />
                    <Button icon={<DotsThreeVertical size={14} />} type="text" />
                </div>
            </div>

            <div className="flex items-start justify-start gap-4">
                <div className="w-[100px]">
                    <Button icon={<Play size={14} />}>Run</Button>
                </div>

                {isOutput === "empty" ? (
                    <Text type="secondary">Click to generate output</Text>
                ) : isOutput === "error" ? (
                    <Text type="danger">Error generating output</Text>
                ) : (
                    <div className="flex flex-col gap-3">
                        <Text type="success">Output generated</Text>

                        <div className="flex items-center gap-1">
                            <Button icon={<TreeView size={14} />} />
                            <Tag color="green" bordered={false} className="flex items-center gap-1">
                                <CheckCircle size={14} /> {status}
                            </Tag>
                            <Tag
                                color="default"
                                bordered={false}
                                className="flex items-center gap-1"
                            >
                                <Timer size={14} /> {time_end}
                            </Tag>
                            <Tag
                                color="default"
                                bordered={false}
                                className="flex items-center gap-1"
                            >
                                <PlusCircle size={14} /> {cost}
                            </Tag>
                        </div>
                    </div>
                )}
            </div>

            <div className="-mx-3">
                <Divider className="!my-2 !mx-0" />
            </div>
        </div>
    )
}

export default PlaygroundVariables
