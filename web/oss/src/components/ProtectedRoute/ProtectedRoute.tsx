import {memo, type FC, type PropsWithChildren} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import {useSession} from "@/oss/hooks/useSession"
import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"
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

    if (shell === "blank") return <div className="h-dvh w-full" />

    return (
        <div className="flex h-dvh w-full">
            <div
                className={clsx(
                    "h-full shrink-0 border-0 border-r border-solid border-[var(--ag-surface-divider)] bg-[var(--ag-sidebar-bg)]",
                    collapsed ? "w-[80px]" : "w-[236px]",
                )}
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
