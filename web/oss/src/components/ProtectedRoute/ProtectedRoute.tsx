import {memo, type FC, type PropsWithChildren} from "react"

import {useAtomValue} from "jotai"

import {useSession} from "@/oss/hooks/useSession"
import {
    SIDEBAR_COLLAPSED_WIDTH,
    sidebarCollapsedAtom,
    sidebarWidthAtom,
} from "@/oss/lib/atoms/sidebar"
import {selectedOrgAtom, selectedOrgQueryAtom} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import {protectedRouteLatchedReadyAtom} from "@/oss/state/url/test"

// Null-rendering island for the boot-volatile session/project/profile/org hook mounts:
// their effects and query subscriptions must stay alive here, but their re-renders
// must not drag the page subtree along.
const BootSubscriptions = memo(function BootSubscriptions() {
    useSession()
    useProjectData()
    useProfileData()
    useAtomValue(selectedOrgAtom)
    useAtomValue(selectedOrgQueryAtom)
    return null
})

// First-boot placeholder so gate release is a fill-in, not a mount from blank
const BootShell = memo(function BootShell({shell}: {shell: "app" | "blank"}) {
    const collapsed = useAtomValue(sidebarCollapsedAtom)
    const width = useAtomValue(sidebarWidthAtom)

    if (shell === "blank") return <div className="h-dvh w-full" />

    return (
        <div className="flex h-dvh w-full">
            <div
                className="h-full shrink-0 border-0 border-r border-solid border-[var(--ag-shell-line)] bg-[var(--ag-sidebar-bg)]"
                style={{width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : width}}
            />
            <div className="grow" />
        </div>
    )
})

const ProtectedRoute: FC<PropsWithChildren<{shell?: "app" | "blank"}>> = ({
    children,
    shell = "blank",
}) => {
    const ready = useAtomValue(protectedRouteLatchedReadyAtom)

    return (
        <>
            <BootSubscriptions />
            {ready ? children : <BootShell shell={shell} />}
        </>
    )
}

export default ProtectedRoute
