import {useMemo} from "react"

import {fetchMountFileBlob} from "@agenta/entities/drive"

import {blobToDataUri, type AssembleIo} from "./assemble"

/** Mount-backed {@link AssembleIo}; null without a mount (a local composer attachment). */
export const useMountAssembleIo = (mountId: string | null, projectId: string | null) =>
    useMemo<AssembleIo | null>(() => {
        if (!mountId || !projectId) return null
        return {
            fetchText: async (path) => {
                const blob = await fetchMountFileBlob({mountId, projectId, path})
                return blob ? blob.text() : null
            },
            fetchDataUri: async (path) =>
                blobToDataUri(await fetchMountFileBlob({mountId, projectId, path})),
        }
    }, [mountId, projectId])
