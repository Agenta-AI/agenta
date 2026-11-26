import {DriveFileCard} from "@agenta/entity-ui/drive"

import type {TurnFile} from "./turnFileList"

/** The files a settled turn created, updated or linked to, as full-width tiles under its answer. */
export const TurnFiles = ({files}: {files: TurnFile[]}) =>
    files.length ? (
        <div className="flex flex-col gap-2">
            {files.map((file) =>
                file.op === "link" ? (
                    <DriveFileCard key={file.path} path={file.path} listedOnly />
                ) : (
                    <DriveFileCard key={file.path} path={file.path} op={file.op} />
                ),
            )}
        </div>
    ) : null
