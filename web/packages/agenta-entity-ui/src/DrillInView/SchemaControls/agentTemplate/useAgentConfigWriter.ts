/**
 * The one place a view reads and writes the agent configuration (`parameters.agent`) of a
 * revision. It writes the same draft the configuration section writes, so auto-save saves the
 * change as a new version, as production does. A view never writes the config another way.
 *
 * Auto-save replaces the revision while a view stays open (a picker adds two apps in a row). The
 * container that shows the agent says which revision it shows now ({@link AgentRevisionContext}),
 * and its open views follow it, so a next write starts from the saved configuration.
 */
import {createContext, useCallback, useContext, useMemo} from "react"

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

/**
 * The revision of the agent the container shows now. A container that hosts agent views provides
 * it around its view stack; outside one, a view writes the revision of its target.
 */
export const AgentRevisionContext = createContext<string | null>(null)

export interface AgentConfigWriter {
    /** The agent configuration as edited (local draft first). */
    agent: Config
    /** The schema of the agent configuration, which decides the sections and fields. */
    schema: SchemaProperty | null
    /** The revision the writes land on: the container's current one, else the view's target. */
    revisionId: string
    /**
     * Replace the agent configuration. `next` gets the latest configuration at write time. Nothing
     * is written while the revision's configuration has not loaded.
     */
    update: (next: (agent: Config) => Config) => void
}

export const useAgentConfigWriter = (
    targetRevisionId: string,
    /** A read-only view shows the saved configuration, not a local draft, and writes nothing. */
    {readOnly = false}: {readOnly?: boolean} = {},
): AgentConfigWriter => {
    const store = useStore()
    const revisionId = useContext(AgentRevisionContext) ?? targetRevisionId
    const configurationAtom = workflowMolecule.selectors.configuration(revisionId)
    const agent = agentOf(
        useAtomValue(
            readOnly
                ? workflowMolecule.selectors.serverConfiguration(revisionId)
                : configurationAtom,
        ),
    )
    const schemaAtom = useMemo(
        () => moleculeSchemaAtPath({id: revisionId, path: ["agent"]}),
        [revisionId],
    )
    const schema = useAtomValue(schemaAtom) as SchemaProperty | null

    const update = useCallback(
        (next: (agent: Config) => Config) => {
            // Read at write time: two writes in one tick must not drop the first.
            const parameters = store.get(configurationAtom) as Config | null
            // A write over a configuration that has not loaded would replace it with an empty one.
            if (readOnly || !parameters) return
            store.set(workflowMolecule.actions.updateConfiguration, revisionId, {
                ...parameters,
                agent: next(agentOf(parameters)),
            })
        },
        [store, configurationAtom, revisionId, readOnly],
    )
    return {agent, schema, revisionId, update}
}
