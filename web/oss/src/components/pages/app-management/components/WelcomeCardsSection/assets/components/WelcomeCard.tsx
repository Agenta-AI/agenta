import {ArrowUpRightIcon} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

interface WelcomeCardProps {
    title: string
    subtitle: string
    onClick: () => void
    hidden?: boolean
}

const welcomeCardContainerClass =
    "flex flex-col w-full flex-1 border border-colorBorderSecondary rounded-[10px] bg-colorBgContainer shadow-[0_1px_2px_0_rgba(0,0,0,0.03),0_1px_6px_-1px_rgba(0,0,0,0.02),0_2px_4px_0_rgba(0,0,0,0.02)] cursor-pointer transition-colors duration-200 hover:bg-colorFillTertiary"

const WelcomeCard = ({title, subtitle, onClick, hidden}: WelcomeCardProps) => {
    return (
        <div onClick={onClick} className={hidden ? "hidden" : welcomeCardContainerClass}>
            <div className="flex flex-1 flex-col gap-1 p-4">
                <Typography.Text className="!text-base !font-medium">{title}</Typography.Text>
                <Typography.Text className="!text-sm !text-[var(--ag-c-586673)]">
                    {subtitle}
                </Typography.Text>
            </div>
            <div className="flex items-end justify-end p-4">
                <Button
                    type="text"
                    icon={<ArrowUpRightIcon size={18} />}
                    className="pointer-events-none text-[var(--ag-c-6B7280)] hover:!bg-transparent"
                />
            </div>
        </div>
    )
}

export default WelcomeCard
