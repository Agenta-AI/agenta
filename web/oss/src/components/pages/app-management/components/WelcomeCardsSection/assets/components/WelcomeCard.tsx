import {ArrowUpRightIcon} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

import {useStyles} from "../styles"

interface WelcomeCardProps {
    title: string
    subtitle: string
    onClick: () => void
    hidden?: boolean
}

const WelcomeCard = ({title, subtitle, onClick, hidden}: WelcomeCardProps) => {
    const classes = useStyles()

    return (
        <div onClick={onClick} className={hidden ? "hidden" : classes.welcomeCardContainer}>
            <div className="flex flex-1 flex-col gap-1 p-4">
                <Typography.Text className="!text-base !font-medium">{title}</Typography.Text>
                <Typography.Text className="!text-sm !text-[#586673]">{subtitle}</Typography.Text>
            </div>
            <div className="flex items-end justify-end p-4">
                <Button
                    type="text"
                    icon={<ArrowUpRightIcon size={18} />}
                    className="pointer-events-none text-[#6B7280] hover:!bg-transparent"
                />
            </div>
        </div>
    )
}

export default WelcomeCard
