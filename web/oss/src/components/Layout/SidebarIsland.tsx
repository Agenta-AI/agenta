import {memo} from "react"

import Sidebar from "../Sidebar/Sidebar"
interface SidebarIslandProps {
    showSettingsView: boolean
    lastPath: string | null
}

// Pure, memo-wrapped island so updates inside Layout don’t re-render it unless its props change
export const SidebarIsland = memo(function SidebarIsland(props: SidebarIslandProps) {
    return <Sidebar {...props} />
})
