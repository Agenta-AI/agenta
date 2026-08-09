import {sidebarCollapsedAtom} from "@agenta/navigation"
import {SidebarSkeletonLoader as SidebarSkeletonLoaderView} from "@agenta/navigation-ui"
import {useAtomValue} from "jotai"

const SidebarSkeletonLoader = () => (
    <SidebarSkeletonLoaderView collapsed={useAtomValue(sidebarCollapsedAtom)} />
)

export default SidebarSkeletonLoader
