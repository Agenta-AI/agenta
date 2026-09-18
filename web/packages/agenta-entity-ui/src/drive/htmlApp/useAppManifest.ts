/**
 * Loads the app's `app.json` from the entry file's folder. Absent (or not an app) → null: Run
 * still works, with the manifest defaults (`read` access, `index.html`, kit on).
 */
import {useEffect, useState} from "react"

import {APP_MANIFEST_FILENAME, parseManifest, type AppManifest} from "@agenta/entities/drive"

import {joinPath, type AssembleIo} from "./assemble"

export interface AppManifestState {
    manifest: AppManifest | null
    /** False until the read settled (present, absent or unreadable). */
    loaded: boolean
}

export function useAppManifest(io: AssembleIo | null, dir: string): AppManifestState {
    const [state, setState] = useState<AppManifestState>({manifest: null, loaded: !io})

    useEffect(() => {
        if (!io) {
            setState({manifest: null, loaded: true})
            return
        }
        let alive = true
        setState({manifest: null, loaded: false})
        io.fetchText(joinPath(dir, APP_MANIFEST_FILENAME))
            .then((text) => {
                if (!alive) return
                setState({manifest: text == null ? null : parseManifest(text), loaded: true})
            })
            .catch(() => {
                if (alive) setState({manifest: null, loaded: true})
            })
        return () => {
            alive = false
        }
    }, [io, dir])

    return state
}
