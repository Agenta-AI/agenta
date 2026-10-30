import Link from "next/link"

import {PluginFrame} from "./PluginFrame"
import {PluginLayout} from "./PluginLayout"
import {usePlugin} from "./usePlugins"

export function PluginScreen({
    workspaceId,
    projectId,
    pluginId,
}: {
    workspaceId: string
    projectId: string
    pluginId: string
}) {
    const query = usePlugin(projectId, pluginId)
    const plugin = query.data?.data?.parameters?.plugin as
        | {ui?: {html?: string}; operations?: {name: string}[]}
        | undefined
    return (
        <PluginLayout
            workspaceId={workspaceId}
            projectId={projectId}
            title={query.data?.name ?? "Plugin"}
            fill
        >
            <div className="px-4 pb-3 lg:px-16">
                <Link
                    className="text-sm text-muted-foreground underline"
                    href={`/w/${workspaceId}/p/${projectId}/plugins`}
                >
                    All plugins
                </Link>
            </div>
            {query.isPending ? (
                <p role="status" className="p-6 text-muted-foreground">
                    Loading plugin…
                </p>
            ) : query.isError ? (
                <div role="alert" className="p-6">
                    <p>{query.error.message}</p>
                    <button className="mt-3 underline" onClick={() => void query.refetch()}>
                        Try again
                    </button>
                </div>
            ) : plugin?.ui?.html ? (
                <PluginFrame
                    key={query.data.id}
                    html={plugin.ui.html}
                    title={query.data.name ?? "Plugin"}
                    projectId={projectId}
                    revisionId={query.data.id}
                    operations={(plugin.operations ?? []).map((operation) => operation.name)}
                />
            ) : (
                <p className="p-6 text-muted-foreground">This plugin has tools but no page.</p>
            )}
        </PluginLayout>
    )
}
