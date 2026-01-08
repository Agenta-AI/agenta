import {CaretDown} from "@phosphor-icons/react"
import {Button, InputNumber, Popover, Slider, Typography} from "antd"
import {useAtom} from "jotai"

import {repetitionCountAtom} from "@/oss/state/newPlayground/generation/options"

const RunOptionsPopover = ({isRunning, variantId}: {isRunning: boolean; variantId: string}) => {
    const [repetitionCount, setRepetitionCount] = useAtom(repetitionCountAtom)

    const content = (
        <div className="flex flex-col gap-4 w-[300px]">
            <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                    <Typography.Text strong>Repetitions</Typography.Text>
                    <InputNumber
                        min={1}
                        max={10}
                        value={repetitionCount}
                        onChange={(val) => setRepetitionCount(val || 1)}
                        size="small"
                        className="w-[60px]"
                        disabled={isRunning}
                    />
                </div>
                <Typography.Text type="secondary" className="text-xs">
                    Run the same prompt multiple times to reduce variability in results.{" "}
                </Typography.Text>
                <Slider
                    min={1}
                    max={10}
                    value={repetitionCount}
                    onChange={(val) => setRepetitionCount(val)}
                    disabled={isRunning}
                />
            </div>
        </div>
    )

    return (
        <Popover
            content={content}
            trigger="click"
            placement="bottomRight"
            arrow={false}
            overlayInnerStyle={{padding: "16px"}}
        >
            <Button
                type="primary"
                icon={<CaretDown size={14} />}
                size="small"
                disabled={isRunning}
                style={{
                    borderRadius: "0 6px 6px 0",
                    borderLeft: "1px solid rgba(255, 255, 255, 0.4)",
                    width: "32px",
                    padding: 0,
                }}
            />
        </Popover>
    )
}

export default RunOptionsPopover
