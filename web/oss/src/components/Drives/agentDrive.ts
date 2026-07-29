/**
 * App drive data (#5247 `POST /mounts/agents/query`): the agent's ONE durable folder, keyed by
 * the workflow artifact id. Read-never-creates — a mount exists only after a run on a #5247
 * runner, so `null` covers both "backend not deployed yet" and "agent never ran": the App drive
 * row simply stays gated until a mount appears, and lights up by itself once one does.
 *
 * Axios (not Fern) on purpose: the client hasn't been regenerated with `query_agent_mount`;
 * `_ignoreError` keeps the probe silent on deployments without the endpoint. Migrate to the
 * Fern client after regeneration (same note as the PR's own fetcher).
 */
import {type Mount} from "@agenta/entities/session"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project"

export async function fetchAgentMount({
    artifactId,
    projectId,
}: {
    artifactId: string
    projectId: string
}): Promise<Mount | null> {
    if (!artifactId || !projectId) return null
    try {
        const response = await axios.post<{mounts?: Mount[] | null}>(
            `${getAgentaApiUrl()}/mounts/agents/query`,
            {artifact_id: artifactId},
            {params: {project_id: projectId}, _ignoreError: true} as Record<string, unknown>,
        )
        return response.data.mounts?.[0] ?? null
    } catch {
        return null
    }
}

export const agentMountQueryFamily = atomFamily((artifactId: string) =>
    atomWithQuery<Mount | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: ["mounts", "agent", projectId, artifactId],
            queryFn: () => fetchAgentMount({artifactId, projectId}),
            enabled: Boolean(artifactId && projectId),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)
