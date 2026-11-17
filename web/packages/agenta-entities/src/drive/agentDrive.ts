/**
 * The agent's drive found by its artifact id (`POST /mounts/agents/query`): the home drive of a
 * configuration without a `drives` list, saved before drives were listed. Read never creates, so
 * `null` means the agent has no drive.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryAgentMounts, type Mount} from "@agenta/entities/session"

export const agentMountQueryFamily = atomFamily((artifactId: string) =>
    atomWithQuery<Mount | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: ["mounts", "agent", projectId, artifactId],
            // At most one mount comes back; every consumer wants it or null. A failed lookup is an
            // error, not "no drive".
            queryFn: async () => {
                const mounts = await queryAgentMounts({artifactId, projectId, lowPriority: true})
                if (mounts === null) throw new Error("The agent drive lookup failed")
                return mounts[0] ?? null
            },
            retry: false,
            enabled: Boolean(artifactId && projectId),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)
