import type {ReactNode} from "react"

import {pageContentWidthClass} from "@agenta/ui/components/page-width"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindProjectContext} from "@/features/context/useBindProjectContext"
import {AppShell} from "@/features/nav/AppShell"
import {NavDrawer} from "@/features/nav/NavDrawer"
export function PluginLayout({
    workspaceId,
    projectId,
    title,
    children,
    fill = false,
}: {
    workspaceId: string
    projectId: string
    title: string
    children: ReactNode
    fill?: boolean
}) {
    useBindProjectContext(projectId)
    return (
        <>
            <PageTitle title={title} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill={fill}
                    header={
                        <div
                            className={`px-4 pb-3 pt-3 lg:pt-14 lg:px-16 ${pageContentWidthClass}`}
                        >
                            <div className="flex items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="min-w-0 flex-1 truncate text-base font-semibold sm:text-2xl">
                                    {title}
                                </h1>
                            </div>
                        </div>
                    }
                >
                    {children}
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
