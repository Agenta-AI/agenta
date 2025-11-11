import {useMemo} from "react"
import {useLocalStorage} from "usehooks-ts"

import UpdateBanner from "@/oss/components/Banners/UpdateBanner"
import {SIDEBAR_UPDATES, SidebarUpdate} from "@/oss/components/SidePanel/assets/updates"

export const useCurrentSidebarUpdate = () => {
    const [dismissed, setDismissed] = useLocalStorage<string[]>("agenta-updates-dismissed", [])

    const current = useMemo<SidebarUpdate | undefined>(() => {
        return SIDEBAR_UPDATES.find((u) => !dismissed.includes(u.id))
    }, [dismissed])

    const dismiss = (id: string) => setDismissed([...dismissed, id])

    return {current, dismiss}
}

const SidePanelUpdates = ({
    collapsed,
    isHovered,
}: {
    collapsed: boolean
    isHovered: boolean
}) => {
    const {current: currentUpdate, dismiss} = useCurrentSidebarUpdate()

    if (!currentUpdate) return null

    if (collapsed && !isHovered) return null

    const handleClose = () => dismiss(currentUpdate.id)

    return <UpdateBanner update={currentUpdate} onClose={handleClose} />
}

export default SidePanelUpdates
