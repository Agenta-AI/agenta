/**
 * The one place a view reads and writes the agent configuration (`parameters.agent`) of a
 * revision. It writes the same draft the configuration section writes, so auto-save saves the
 * change as a new version, as production does. A view never writes the config another way.
 *
 * Auto-save replaces the revision while a view stays open (a picker adds two apps in a row).
 * The section records each replacement, and an open view follows it, so its next write starts
 * from the saved configuration and lands on the revision on screen.
 */
import {useCallback, useEffect, useMemo, useRef} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue, useSetAtom, useStore} from "jotai"

import {moleculeSchemaAtPath} from "../../components/PlaygroundConfigSection/atoms"

type Config = Record<string, unknown>

const EMPTY: Config = {}

const agentOf = (parameters: unknown): Config => {
    const agent = (parameters as {agent?: unknown} | null)?.agent
    return agent && typeof agent === "object" ? (agent as Config) : EMPTY
}

/** For each revision the section left, the revision it moved to. */
export const revisionSuccessorsAtom = atom<Record<string, string>>({})

/** The revision `revisionId` became, following each recorded replacement. */
export const followRevision = (successors: Record<string, string>, revisionId: string): string => {
    let current = revisionId
    const seen = new Set<string>()
    while (successors[current] && !seen.has(current)) {
        seen.add(current)
        current = successors[current]
    }
    return current
}

/** Called by the section's host: records a revision change so open views follow it. */
export const useRecordRevisionSuccessor = (revisionId: string | null): void => {
    const record = useSetAtom(revisionSuccessorsAtom)
    const previous = useRef(revisionId)
    useEffect(() => {
        const from = previous.current
        previous.current = revisionId
        if (from && revisionId && from !== revisionId) {
            record((current) => ({...current, [from]: revisionId}))
        }
    }, [revisionId, record])
}

export interface AgentConfigWriter {
    /** The agent configuration as edited (local draft first). */
    agent: Config
    /** The schema of the agent configuration, which decides the sections and fields. */
    schema: SchemaProperty | null
    /** The revision the writes land on: the view's target, or the revision that replaced it. */
    revisionId: string
    /** Replace the agent configuration. `next` gets the latest configuration at write time. */
    update: (next: (agent: Config) => Config) => void
}

export const useAgentConfigWriter = (targetRevisionId: string): AgentConfigWriter => {
    const store = useStore()
    const revisionId = followRevision(useAtomValue(revisionSuccessorsAtom), targetRevisionId)
    const configurationAtom = workflowMolecule.selectors.configuration(revisionId)
    const agent = agentOf(useAtomValue(configurationAtom))
    const schemaAtom = useMemo(
        () => moleculeSchemaAtPath({id: revisionId, path: ["agent"]}),
        [revisionId],
    )
    const schema = useAtomValue(schemaAtom) as SchemaProperty | null

    const update = useCallback(
        (next: (agent: Config) => Config) => {
            // Read at write time: two writes in one tick must not drop the first.
            const parameters = (store.get(configurationAtom) ?? {}) as Config
            store.set(workflowMolecule.actions.updateConfiguration, revisionId, {
                ...parameters,
                agent: next(agentOf(parameters)),
            })
        },
        [store, configurationAtom, revisionId],
    )
    return {agent, schema, revisionId, update}
}
