import type {FileActivity} from "@agenta/entities/session"
import {DriveFileCard} from "@agenta/entity-ui/drive"

/** The files a settled turn created or updated, as full-width tiles under its answer. */
export const TurnFiles = ({files}: {files: FileActivity[]}) =>
    files.length ? (
        <div className="flex flex-col gap-2">
            {files.map((file) => (
                <DriveFileCard key={file.path} path={file.path} op={file.op} />
            ))}
        </div>
    ) : null
