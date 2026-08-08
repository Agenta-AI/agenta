/**
 * App drive data (#5247 `POST /mounts/agents/query`): the agent's ONE durable folder, keyed by
 * the workflow artifact id. Read-never-creates — a mount exists only after a run on a #5247
 * runner, so `null` covers both "backend not deployed yet" and "agent never ran": the App drive
 * row simply stays gated until a mount appears, and lights up by itself once one does.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryAgentMounts, type Mount} from "@agenta/entities/session"

export const agentMountQueryFamily = atomFamily((artifactId: string) =>
    atomWithQuery<Mount | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: ["mounts", "agent", projectId, artifactId],
            // At most one mount comes back; every consumer wants it or null.
            queryFn: async () =>
                (await queryAgentMounts({artifactId, projectId, lowPriority: true}))?.[0] ?? null,
            enabled: Boolean(artifactId && projectId),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)
