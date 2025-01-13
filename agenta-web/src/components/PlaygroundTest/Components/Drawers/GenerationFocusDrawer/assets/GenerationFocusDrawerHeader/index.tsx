import {Button, Radio, Space, Typography} from "antd"
import {CaretDown, CaretUp, FloppyDisk, Play} from "@phosphor-icons/react"
import {GenerationFocusDrawerHeaderProps} from "./types"
import clsx from "clsx"

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
                    <Radio.Group value={format} onChange={(e) => setFormat(e.target.value)}>
                        <Radio.Button value="pretty">Pretty</Radio.Button>
                        <Radio.Button value="json">JSON</Radio.Button>
                        <Radio.Button value="yaml">YAML</Radio.Button>
                    </Radio.Group>
                </div>

                <Button icon={<Play size={14} />} disabled={isRunning} onClick={runRow}>
                    Re run
                </Button>
                <Button icon={<FloppyDisk size={14} />}>Add to test set</Button>
            </Space>
        </section>
    )
}

export default GenerationFocusDrawerHeader
