import {ArrowLeft} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"

interface SidebarBackButtonProps {
    collapsed: boolean
    lastPath?: string
    className?: string
}

const SidebarBackButton = ({collapsed, lastPath, className}: SidebarBackButtonProps) => {
    const router = useRouter()

    return (
        <Button
            aria-label="Back"
            className={clsx(
                "gap-2 flex items-center justify-center",
                !collapsed && "ml-2",
                className,
            )}
            type="text"
            size={!collapsed ? "small" : "medium"}
            icon={<ArrowLeft size={14} />}
            onClick={() => {
                if (lastPath) router.push(lastPath)
                else router.back()
            }}
        >
            {!collapsed && "Back"}
        </Button>
    )
}

export default SidebarBackButton
