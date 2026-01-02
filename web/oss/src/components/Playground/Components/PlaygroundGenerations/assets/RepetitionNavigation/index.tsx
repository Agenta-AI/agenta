import {LeftOutlined, RightOutlined} from "@ant-design/icons"
import {Button, Typography} from "antd"

interface RepetitionNavigationProps {
    current: number // 1-based index
    total: number
    onNext: () => void
    onPrev: () => void
    disabled?: boolean
}

const RepetitionNavigation = ({
    current,
    total,
    onNext,
    onPrev,
    disabled,
}: RepetitionNavigationProps) => {
    if (total <= 1) return null

    return (
        <div className="flex items-center gap-2">
            <Button
                icon={<LeftOutlined />}
                size="small"
                onClick={onPrev}
                disabled={disabled || current <= 1}
            />
            <Typography.Text type="secondary" className="text-[10px] text-nowrap">
                {current} / {total}
            </Typography.Text>
            <Button
                icon={<RightOutlined />}
                size="small"
                onClick={onNext}
                disabled={disabled || current >= total}
            />
        </div>
    )
}

export default RepetitionNavigation
