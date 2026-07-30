import {type Mount} from "@agenta/entities/session"
import {DownloadSimple} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue} from "jotai"
import {AnimatePresence, motion} from "motion/react"

import {projectIdAtom} from "@/oss/state/project"

import {resolveDriveFileKind} from "./driveKinds"
import {downloadMountFile} from "./driveMedia"
import {DriveFileBody} from "./renderers"

/** The content viewer — the renderer registry (build-spec 3): kind-matched body, size caps,
 * Download fallback. Shared by the drawer preview and the chat Quick Look.
 *
 * Crossfade keyed by KIND, not path: switching between files of the same type reconciles the same
 * body in place (unchanged, smooth); switching types swaps the body component entirely (image →
 * markdown), which without this reads as a hard cut. Fading the old kind out and the new one in
 * (`mode="wait"` avoids overlapping two variable-height bodies) turns that swap into a replace. */
export const DriveFileContentViewer = ({
    mount,
    path,
    size,
    displayPath,
    onNavigate,
}: {
    mount: Mount | null
    path: string
    size?: number | null
    /** Presented path + navigate callback — used by the HTML preview to route internal links. */
    displayPath?: string
    onNavigate?: (path: string) => void
}) => {
    const kind = resolveDriveFileKind(path)
    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={kind}
                initial={{opacity: 0}}
                animate={{opacity: 1}}
                exit={{opacity: 0}}
                transition={{duration: 0.15}}
                className="flex min-h-0 flex-1 flex-col"
            >
                <DriveFileBody
                    mount={mount}
                    path={path}
                    size={size}
                    displayPath={displayPath}
                    onNavigate={onNavigate}
                />
            </motion.div>
        </AnimatePresence>
    )
}

/** Download button for one file — raw bytes, so every type round-trips (not just text). */
export const DriveFileDownloadButton = ({mount, path}: {mount: Mount | null; path: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    return (
        <Button
            icon={<DownloadSimple size={13} />}
            disabled={!mount}
            onClick={() => void downloadMountFile({mount, path, projectId})}
        >
            Download
        </Button>
    )
}
