import {Button, Radio, Space, Typography} from "antd"
import {CaretDown, CaretUp, FloppyDisk} from "@phosphor-icons/react"
import {GenerationFocusDrawerHeaderProps} from "./types"
import clsx from "clsx"
import RunButton from "@/components/NewPlayground/assets/RunButton"

const GenerationFocusDrawerHeader = ({
    format,
    setFormat,
    className,
    variantId,
    runRow,
    isRunning,
    loadNextRow,
    loadPrevRow,
    inputRows,
    rowId,
}: GenerationFocusDrawerHeaderProps) => {
    return (
        <section className={clsx("!w-full flex items-center justify-between", className)}>
            <Space className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                    <Button
                        icon={<CaretUp size={14} />}
                        type="text"
                        onClick={loadPrevRow}
                        disabled={!rowId || rowId === inputRows[0].__id}
                    />
                    <Button
                        icon={<CaretDown size={14} />}
                        type="text"
                        onClick={loadNextRow}
                        disabled={!rowId || rowId === inputRows[inputRows.length - 1].__id}
                    />
                </div>

                <Typography.Text>Generation</Typography.Text>
            </Space>
            <Space className="flex items-center gap-2">
                <div>
                    <Radio.Group
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                        size="small"
                    >
                        <Radio.Button value="PRETTY">Pretty</Radio.Button>
                        <Radio.Button value="JSON">JSON</Radio.Button>
                        <Radio.Button value="YAML">YAML</Radio.Button>
                    </Radio.Group>
                </div>

                <RunButton onClick={runRow} disabled={isRunning} />

                <Button icon={<FloppyDisk size={14} />} size="small">
                    Add to test set
                </Button>
            </Space>
        </section>
    )
}

export default GenerationFocusDrawerHeader
