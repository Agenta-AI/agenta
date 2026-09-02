import {SidebarBackButton as SidebarBackButtonView} from "@agenta/navigation-ui"
import {useRouter} from "next/router"

interface SidebarBackButtonProps {
    collapsed: boolean
    lastPath?: string
    className?: string
}

/** OSS binding: "Back" prefers the scope's remembered path, else browser history. */
const SidebarBackButton = ({collapsed, lastPath, className}: SidebarBackButtonProps) => {
    const router = useRouter()
    return (
        <SidebarBackButtonView
            collapsed={collapsed}
            className={className}
            onBack={() => {
                if (lastPath) router.push(lastPath)
                else router.back()
            }}
        />
    )
}

export default SidebarBackButton
