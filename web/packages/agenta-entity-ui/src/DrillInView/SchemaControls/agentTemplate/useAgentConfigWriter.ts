/**
 * The one place a view reads and writes the agent configuration (`parameters.agent`) of a
 * revision. It writes the same draft the configuration section writes, so auto-save saves the
 * change as a new version, as production does. A view never writes the config another way.
 */
import {useCallback, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue, useStore} from "jotai"

import {moleculeSchemaAtPath} from "../../components/PlaygroundConfigSection/atoms"

type Config = Record<string, unknown>

const EMPTY: Config = {}

const agentOf = (parameters: unknown): Config => {
    const agent = (parameters as {agent?: unknown} | null)?.agent
    return agent && typeof agent === "object" ? (agent as Config) : EMPTY
}

export interface AgentConfigWriter {
    /** The agent configuration as edited (local draft first). */
    agent: Config
    /** The schema of the agent configuration, which decides the sections and fields. */
    schema: SchemaProperty | null
    /** Replace the agent configuration from the latest one. A function reads the latest value. */
    update: (next: (agent: Config) => Config) => void
    /** Set one top-level field (instructions, llm, tools, mcps, skills). */
    setField: (field: string, value: unknown) => void
}

export const useAgentConfigWriter = (revisionId: string): AgentConfigWriter => {
    const store = useStore()
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
    const setField = useCallback(
        (field: string, value: unknown) => update((current) => ({...current, [field]: value})),
        [update],
    )
    return {agent, schema, update, setField}
}
