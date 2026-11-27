/** Row 2's type mark + file name, renamed in place through {@link DriveNameField}. */
import {useEffect, useState} from "react"

import {nameOf} from "@agenta/entities/drive"
import {useT} from "@agenta/i18n"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"

import {DriveNameField} from "./DriveNameField"
import {DriveTypeMark} from "./DriveTypeMark"

export const DriveInlineName = ({
    path,
    validate,
    onRename,
}: {
    path: string
    validate?: (name: string) => string | null
    /** Absent = read-only. */
    onRename?: (name: string) => Promise<boolean>
}) => {
    const t = useT(driveExplorerCatalog)
    const name = nameOf(path)
    const [editing, setEditing] = useState(false)
    useEffect(() => setEditing(false), [path])

    return (
        <span className="flex min-w-0 items-center gap-1.5 pl-1">
            <DriveTypeMark path={path} size="mini" />
            {editing && onRename ? (
                <DriveNameField
                    initial={name}
                    validate={validate ?? (() => null)}
                    onCommit={async (next) => {
                        const ok = await onRename(next)
                        if (ok) setEditing(false)
                        return ok
                    }}
                    onCancel={() => setEditing(false)}
                    className="h-control-xs w-60 max-w-full px-1.5 text-label"
                />
            ) : onRename ? (
                <button
                    type="button"
                    title={t("entityUi.driveExplorer.rename")}
                    onClick={() => setEditing(true)}
                    className="h-control-xs cursor-text truncate rounded-sm border-0 bg-transparent px-1 py-0 text-label font-medium text-foreground hover:bg-accent"
                >
                    {name}
                </button>
            ) : (
                <span className="truncate px-1 text-label font-medium text-foreground" title={path}>
                    {name}
                </span>
            )}
        </span>
    )
}
