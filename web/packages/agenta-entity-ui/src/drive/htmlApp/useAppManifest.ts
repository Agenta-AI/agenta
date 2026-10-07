/**
 * Loads the app's `app.json` from the entry file's folder. Absent (or not an app) → null: Run
 * still works, with the manifest defaults (`read` access, `index.html`, kit on).
 */
import {useEffect, useState} from "react"

import {APP_MANIFEST_FILENAME, parseManifest, type AppManifest} from "@agenta/entities/drive"

import {joinAppPath, type AssembleIo} from "./assemble"

export interface AppManifestState {
    manifest: AppManifest | null
    /** False until the read settled (present, absent or unreadable). */
    loaded: boolean
}

export function useAppManifest(io: AssembleIo | null, dir: string): AppManifestState {
    const [state, setState] = useState<AppManifestState & {io: AssembleIo | null; dir: string}>({
        manifest: null,
        loaded: !io,
        io,
        dir,
    })

    useEffect(() => {
        if (!io) {
            setState({manifest: null, loaded: true, io, dir})
            return
        }
        let alive = true
        setState({manifest: null, loaded: false, io, dir})
        io.fetchText(joinAppPath(dir, APP_MANIFEST_FILENAME))
            .then((text) => {
                if (!alive) return
                setState({
                    manifest: text == null ? null : parseManifest(text),
                    loaded: true,
                    io,
                    dir,
                })
            })
            .catch(() => {
                if (alive) setState({manifest: null, loaded: true, io, dir})
            })
        return () => {
            alive = false
        }
    }, [io, dir])

    return state.io === io && state.dir === dir ? state : {manifest: null, loaded: !io}
}
