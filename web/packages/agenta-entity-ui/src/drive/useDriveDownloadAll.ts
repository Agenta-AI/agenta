/**
 * useDriveDownloadAll — the header's "Download all": which mounts the ONE zip spans, the in-flight
 * flag, and the toast-reporting handler (including the failure path's message).
 */
import {useCallback, useMemo, useState} from "react"

import {driveRootLabel} from "@agenta/entities/drive"
import {downloadMountArchive} from "@agenta/entities/drive"
import {AGENT_FILES_DIR, type SessionDriveData} from "@agenta/entities/drive"
import {message} from "@agenta/ui/app-message"

export function useDriveDownloadAll({
    drive,
    projectId,
}: {
    drive: SessionDriveData
    projectId: string | null | undefined
}) {
    // "Download all" — ONE streaming zip spanning every mount the drive folds in (cwd at the root,
    // the agent's durable folder under `agent-files/`). The toast rides the kit message service.
    const [downloadingAll, setDownloadingAll] = useState(false)
    const archiveMounts = useMemo(() => {
        const cwd = drive.mount
        if (!cwd?.id) return []
        const out = [{mountId: cwd.id, prefix: ""}]
        const agent = drive.resolveMount(AGENT_FILES_DIR)
        if (agent && agent.mount.id !== cwd.id) {
            out.push({mountId: agent.mount.id, prefix: AGENT_FILES_DIR})
        }
        return out
    }, [drive])
    const handleDownloadAll = useCallback(async () => {
        if (!archiveMounts.length || downloadingAll) return
        setDownloadingAll(true)
        const key = "drive-download-all"
        message.open({type: "loading", key, content: "Preparing download…", duration: 0})
        // `finally`: the in-flight flag gates every retry (above) and the loading toast has no
        // duration, so anything that skips the reset leaves the button dead and the toast pinned.
        try {
            const result = await downloadMountArchive({
                mounts: archiveMounts,
                projectId,
                filename: `${driveRootLabel(drive.mount)}-files.zip`,
            })
            if (result.cancelled) message.destroy(key)
            else if (result.ok) message.open({type: "success", key, content: "Download ready"})
            else message.open({type: "error", key, content: result.error ?? "Download failed"})
        } finally {
            setDownloadingAll(false)
        }
    }, [archiveMounts, drive.mount, projectId, downloadingAll, message])

    return {archiveMounts, downloadingAll, handleDownloadAll}
}
