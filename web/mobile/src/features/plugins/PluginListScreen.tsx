import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useRouter} from "next/router"

import {useAgentOwners} from "@/features/agents/useAgentOwners"

import {PluginLayout} from "./PluginLayout"
import {PluginListTable} from "./PluginListTable"
import {usePlugins} from "./usePlugins"
export function PluginListScreen({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) {
    const query = usePlugins(projectId)
    const {ownerNames} = useAgentOwners()
    const router = useRouter()
    return (
        <PluginLayout workspaceId={workspaceId} projectId={projectId} title="Plugins">
            <div className={`px-4 pb-12 pt-3 lg:px-16 ${pageContentWidthClass}`}>
                {query.isError ? (
                    <div role="alert" className="py-8">
                        <p>Could not load plugins.</p>
                        <button className="mt-3 underline" onClick={() => void query.refetch()}>
                            Try again
                        </button>
                    </div>
                ) : (
                    <PluginListTable
                        rows={query.data ?? []}
                        loading={query.isPending}
                        owners={ownerNames}
                        onOpen={(row) =>
                            void router.push(`/w/${workspaceId}/p/${projectId}/plugins/${row.id}`)
                        }
                    />
                )}
            </div>
        </PluginLayout>
    )
}
