import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable} from "@agenta/ui/list-table"

import {PluginRowCells} from "./PluginRowCells"
import type {PluginRow} from "./usePlugins"
export function PluginListTable({
    rows,
    loading,
    owners,
    onOpen,
}: {
    rows: PluginRow[]
    loading: boolean
    owners: Map<string, string>
    onOpen: (row: PluginRow) => void
}) {
    const narrow = !useMediaQuery("(min-width: 640px)")
    const columns = [
        {key: "name", label: "Plugin", width: "minmax(160px,2fr)"},
        ...(!narrow ? [{key: "owner", label: "Created by", width: "minmax(96px,1fr)"}] : []),
        {key: "updated", label: "Updated", width: "90px"},
    ]
    return (
        <ListTable
            columns={columns}
            minWidth={280}
            groups={[{key: "all", label: null, rows}]}
            rowKey={(row) => row.id}
            loading={loading}
            onOpenRow={onOpen}
            empty={
                <div className="px-6 py-12 text-center">
                    <h2 className="font-semibold">No plugins yet</h2>
                    <p className="mt-2 text-muted-foreground">
                        Plugins bring tools and pages together. Once a plugin is added to this
                        project, it appears here.
                    </p>
                </div>
            }
            renderRow={(row) => (
                <PluginRowCells
                    row={row}
                    narrow={narrow}
                    owner={owners.get(row.createdById ?? "") ?? "Unknown"}
                />
            )}
        />
    )
}
