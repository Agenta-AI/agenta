/** A shared app: the Run runtime over a snapshot, read-only, under `SHARE_CSP`. */
import {useEffect, useMemo, useState} from "react"

import {
    SHARE_CSP,
    createHtmlAppHost,
    createSnapshotFsClient,
    resolveSnapshotRef,
    snapshotDataUri,
    snapshotFile,
    snapshotText,
    type HtmlAppHost,
    type SharedAppSnapshot,
} from "@agenta/entities/drive"
import {EmptyState} from "@agenta/ui/ui"

import {INLINE_ASSET_CAP, type AssembleIo} from "./assemble"
import {KIT_CSS} from "./kit"
import {RunView, resolveHostKitTokens} from "./RunView"

export interface SharedAppViewProps {
    snapshot: SharedAppSnapshot
    className?: string
}

/** The assembler's view of a snapshot: keys are app paths and captured URLs. */
export const snapshotAssembleIo = (snapshot: SharedAppSnapshot): AssembleIo => ({
    resolve: (base, ref) => resolveSnapshotRef(snapshot, base, ref),
    fetchText: async (key) => {
        const file = snapshotFile(snapshot, key)
        return file ? snapshotText(file) : null
    },
    fetchDataUri: async (key) => {
        const file = snapshotFile(snapshot, key)
        return file && file.bytes.length <= INLINE_ASSET_CAP ? snapshotDataUri(file) : null
    },
})

export function SharedAppView({snapshot, className}: SharedAppViewProps) {
    const io = useMemo(() => snapshotAssembleIo(snapshot), [snapshot])
    const entry = snapshot.files.get(snapshot.entry)
    const [host, setHost] = useState<HtmlAppHost | null>(null)

    useEffect(() => {
        const next = createHtmlAppHost(
            {
                mountId: "shared",
                projectId: "",
                dir: "",
                grant: "read",
                tokens: resolveHostKitTokens(),
            },
            {client: createSnapshotFsClient(snapshot)},
        )
        setHost(next)
        return () => {
            next.detach()
            setHost(null)
        }
    }, [snapshot])

    if (!entry) {
        return (
            <EmptyState
                title="This app cannot be opened"
                description={`Its entry file ${snapshot.entry} is missing from the shared version.`}
            />
        )
    }
    if (!host) return null

    return (
        <RunView
            key={`${snapshot.version}`}
            host={host}
            dir=""
            entryPath={snapshot.entry}
            entryContent={snapshotText(entry)}
            grant="read"
            io={io}
            kitCss={snapshot.kit ? KIT_CSS : null}
            title={snapshot.name}
            csp={SHARE_CSP}
            statusBar={false}
            className={className}
        />
    )
}
