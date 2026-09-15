/** What the markdown and code editors share: the Cmd/Ctrl+S handler and the body placeholders. */
import {type KeyboardEvent, useCallback} from "react"

import {type Mount} from "@agenta/entities/session"
import {Skeleton} from "@agenta/ui/ui"

import {DownloadCard} from "./renderers"

/** Cmd/Ctrl+S on the editor's wrapper writes the draft now. */
export const useDriveSaveKey = (onSave: () => void) =>
    useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault()
                onSave()
            }
        },
        [onSave],
    )

/** The download fallback on a failed read, else a skeleton. */
export const DriveEditorPlaceholder = ({
    mount,
    path,
    failed,
    lines,
}: {
    mount: Mount | null
    path: string
    failed: boolean
    lines: number
}) =>
    failed ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
            <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />
        </div>
    ) : (
        <div className="flex flex-col gap-2 p-5">
            {Array.from({length: lines}).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
            ))}
        </div>
    )
