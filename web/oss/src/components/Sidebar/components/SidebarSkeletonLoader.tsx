import {SidebarSkeletonLoader as SidebarSkeletonLoaderView} from "@agenta/navigation-ui"
import {useAtomValue} from "jotai"

import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"

const SidebarSkeletonLoader = () => (
    <SidebarSkeletonLoaderView collapsed={useAtomValue(sidebarCollapsedAtom)} />
)

export default SidebarSkeletonLoader
