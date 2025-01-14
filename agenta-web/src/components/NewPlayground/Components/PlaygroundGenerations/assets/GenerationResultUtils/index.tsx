import {Button, Tag, Space} from "antd"
import {TreeView, Timer, PlusCircle, CheckCircle} from "@phosphor-icons/react"
import ResultTag from "@/components/ResultTag/ResultTag"
import {GenerationResultUtilsProps} from "./types"
import clsx from "clsx"

const GenerationResultUtils: React.FC<GenerationResultUtilsProps> = ({className}) => {
    const status = "success"
    const time_end = "0.0453s"
    const cost = "79 / $0.0053"

    return (
        <div className={clsx("flex items-center gap-1", className)}>
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
    )
}

export default GenerationResultUtils
