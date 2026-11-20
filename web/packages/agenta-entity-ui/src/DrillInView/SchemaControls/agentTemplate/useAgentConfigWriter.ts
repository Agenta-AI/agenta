/**
 * The one place a view reads and writes the agent configuration (`parameters.agent`) of a
 * revision. It writes the same draft the configuration section writes, so auto-save saves the
 * change as a new version, as production does. A view never writes the config another way.
 *
 * Auto-save replaces the revision while a view stays open (a picker adds two apps in a row), and
 * the edit right can arrive after a view opened. The container that shows the agent says which
 * revision it shows now and whether it may edit it ({@link AgentEditorContext}); its open views
 * follow both.
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

/** The agent a container shows now: the revision on screen, and whether it may be edited. */
export interface AgentEditor {
    revisionId: string
    readOnly: boolean
    /** The agent answers in a channel (a run without a person); absent when unknown. */
    hasChannel?: boolean
}

/**
 * Provided by a container that hosts agent views, around its view stack. Without it a view writes
 * the revision of its target and may edit.
 */
export const AgentEditorContext = createContext<AgentEditor | null>(null)

export interface AgentConfigWriter {
    /** The agent configuration as edited (local draft first). */
    agent: Config
    /** The schema of the agent configuration, which decides the sections and fields. */
    schema: SchemaProperty | null
    /** The revision the writes land on: the container's current one, else the view's target. */
    revisionId: string
    /** No edit right: the view shows the saved configuration and writes nothing. */
    readOnly: boolean
    /**
     * Replace the agent configuration. `next` gets the latest configuration at write time. Nothing
     * is written while the revision's configuration has not loaded.
     */
    update: (next: (agent: Config) => Config) => void
}

export const useAgentConfigWriter = (targetRevisionId: string): AgentConfigWriter => {
    const store = useStore()
    const editor = useContext(AgentEditorContext)
    const revisionId = editor?.revisionId ?? targetRevisionId
    const readOnly = editor?.readOnly ?? false
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
    return {agent, schema, revisionId, readOnly, update}
}
