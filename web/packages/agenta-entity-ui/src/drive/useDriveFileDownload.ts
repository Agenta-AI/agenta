import {useCallback} from "react"

import {downloadMountFile} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {createT} from "@agenta/i18n"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"

// The toasts fire from the download callback, outside render.
const tNow = createT(driveExplorerCatalog)

/** `download(mount, path)` for ONE drive file, reporting the outcome through the themed toast
 * (the kit message service, which renders through the app's own outlet). THE way to trigger a single-file download:
 * {@link downloadMountFile} resolves `false` on failure, so a bare fire-and-forget call left a failed
 * click looking exactly like a successful one. Stable — safe to pass down to list items. */
export function useDriveFileDownload(): (mount: Mount | null, path: string) => Promise<boolean> {
    const projectId = useAtomValue(projectIdAtom)
    return useCallback(
        async (mount: Mount | null, path: string) => {
            // `path` is mount-RELATIVE, so it alone doesn't identify a file: `agent-files/notes.md`
            // and a cwd `notes.md` both arrive here as "notes.md" and would share a toast.
            const key = `drive-download:${mount?.id ?? "none"}:${path}`
            message.open({type: "loading", key, content: tNow("entityUi.driveExplorer.downloading"), duration: 0})
            const ok = await downloadMountFile({mount, path, projectId})
            message.open(
                ok
                    ? {type: "success", key, content: tNow("entityUi.driveExplorer.downloaded")}
                    : {
                          type: "error",
                          key,
                          content: tNow("entityUi.driveExplorer.downloadFailed"),
                      },
            )
            return ok
        },
        [projectId],
    )
}
