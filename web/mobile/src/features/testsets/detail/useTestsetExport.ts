import {useCallback, useState} from "react"

import {downloadRevision, type ExportFileType} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"

/** The file an export saves as: `{name}_v{version}.{ext}`, with unsafe characters made `-`. */
export const revisionExportFileName = (
    name: string,
    version: number | undefined,
    format: ExportFileType,
): string => `${name.replace(/[^a-zA-Z0-9-_]/g, "-")}_v${version ?? 0}.${format}`

/**
 * Exports the revision on screen as a file. One export runs at a time: `exporting` names the
 * format in flight, and a second press while it runs does nothing.
 */
export function useTestsetExport({
    projectId,
    revisionId,
    name,
    version,
}: {
    projectId: string
    revisionId: string | null
    name: string
    version: number | undefined
}) {
    const [exporting, setExporting] = useState<ExportFileType | null>(null)

    const exportAs = useCallback(
        async (format: ExportFileType) => {
            if (exporting) return
            const label = format.toUpperCase()
            if (!revisionId) {
                message.error("No revision to export")
                return
            }
            setExporting(format)
            message.info(`Starting ${label} export...`)
            const hide = message.loading(
                "Preparing export. This may take a moment for large test sets...",
                0,
            )
            try {
                await downloadRevision({
                    projectId,
                    revisionId,
                    fileType: format,
                    filename: revisionExportFileName(name, version, format),
                })
                message.success(`Exported as ${label}`)
            } catch (cause) {
                console.error("Exporting the revision failed", cause)
                message.error(`Failed to export as ${label}`)
            } finally {
                hide()
                setExporting(null)
            }
        },
        [exporting, name, projectId, revisionId, version],
    )

    return {exporting, exportAs}
}
