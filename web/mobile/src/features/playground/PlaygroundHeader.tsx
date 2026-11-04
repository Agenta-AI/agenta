import type {ReactNode} from "react"

import {NavDrawer} from "../nav/NavDrawer"

/** The playground's top bar: the app's name, what this page is, and the page's actions. */
export const PlaygroundHeader = ({
    workspaceId,
    projectId,
    appName,
    actions,
}: {
    workspaceId: string
    projectId: string
    appName: string | null
    actions?: ReactNode
}) => (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <NavDrawer workspaceId={workspaceId} projectId={projectId} />
        <h1 className="m-0 min-w-0 truncate text-sm font-semibold text-foreground">{appName}</h1>
        <span className="shrink-0 text-sm text-muted-foreground">Playground</span>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
)
