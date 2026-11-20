// @vitest-environment jsdom
/**
 * A model pick from the composer (the model button or `/model`) saves a new version of the agent.
 *
 * The pick writes the agent config through `updateConfiguration`, the draft write the
 * Configuration Model section makes too. Auto-save (`agentAutoCommit`, armed when
 * `@agenta/playground/state` loads) sees that write and commits it. The workflow layer is replaced
 * by a small store here: its draft write fires `onDraftChange` the way `updateWorkflowDraftAtom`
 * does, and the commit is recorded instead of sent.
 */
import {act, renderHook} from "@testing-library/react"
import {getDefaultStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const hoisted = vi.hoisted(() => ({
    onDraftChange: null as null | ((workflowId: string) => void),
    commits: [] as {revisionId: string; commitMessage?: string}[],
}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entities/workflow")>()
    const {atom} = await import("jotai")
    const family = <T,>(init: (id: string) => T) => {
        const atoms = new Map<string, ReturnType<typeof atom<T>>>()
        return (id: string) => {
            if (!atoms.has(id)) atoms.set(id, atom<T>(init(id)))
            return atoms.get(id)!
        }
    }
    const saved = {
        agent: {
            harness: {kind: "pi_core"},
            llm: {model: "gpt-5.5", provider: "openai", connection: {mode: "agenta"}},
        },
    }
    const configuration = family<Record<string, unknown> | null>(() => saved)
    const isDirty = family<boolean>(() => false)
    const candidates = atom({
        status: "ready" as const,
        candidates: [],
        connections: [],
        capabilities: null,
    })
    return {
        ...actual,
        registerWorkflowDraftCallbacks: (callbacks: {onDraftChange?: (id: string) => void}) => {
            hoisted.onDraftChange = callbacks.onDraftChange ?? null
        },
        agentModelCandidatesAtomFamily: () => candidates,
        commitWorkflowRevisionAtom: atom(
            null,
            async (_get, set, params: {revisionId: string; commitMessage?: string}) => {
                hoisted.commits.push(params)
                set(isDirty(params.revisionId), false)
                return {success: true, newRevisionId: `${params.revisionId}-next`}
            },
        ),
        invalidateAgentCommittedRevisionCache: () => {},
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                configuration,
                serverConfiguration: family(() => saved),
                parametersSchema: family(() => null),
                data: family((id: string) => ({id, workflow_id: "wf-1"})),
                isAgent: family(() => true),
                isEphemeral: family(() => false),
                isDirty,
            },
            actions: {
                ...actual.workflowMolecule.actions,
                // The draft write: store the config, mark it dirty, tell the draft listeners.
                updateConfiguration: atom(
                    null,
                    (_get, set, id: string, params: Record<string, unknown>) => {
                        set(configuration(id), params)
                        set(isDirty(id), true)
                        hoisted.onDraftChange?.(id)
                    },
                ),
            },
        },
    }
})

// One group in the list, so the palette offers `/model`.
vi.mock("@agenta/entity-ui/drill-in", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entity-ui/drill-in")>()),
    buildConnectionPickerRows: () => [],
    buildPickerGroupsWithSections: () => [
        {key: "agenta", label: "Agenta", options: [{value: "gpt-5.5", label: "GPT-5.5"}]},
    ],
}))

import {workflowMolecule} from "@agenta/entities/workflow"
// Loading the playground state arms auto-save on the draft write, as the app does.
import "@agenta/playground/state"
import {projectIdAtom} from "@agenta/shared/state"

import {useChatSlashCommands} from "../../../src/hooks/useChatSlashCommands"

describe("composer model pick", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        hoisted.commits.length = 0
        getDefaultStore().set(projectIdAtom, "project-1")
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("writes the picked model and auto-save commits it as a new version", async () => {
        const {result} = renderHook(() => useChatSlashCommands({entityId: "rev-1"}))
        act(() => {
            result.current.applyModel("claude-sonnet-5-5", {
                metadata: {provider: "anthropic", connectionMode: "agenta", harness: "pi_core"},
            })
        })
        const written = getDefaultStore().get(
            workflowMolecule.selectors.configuration("rev-1"),
        ) as {agent: {llm: {model: string}}}
        expect(written.agent.llm.model).toBe("claude-sonnet-5-5")
        expect(hoisted.commits).toEqual([])

        // Auto-save waits for a quiet moment, then commits once.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1600)
        })
        expect(hoisted.commits).toHaveLength(1)
        expect(hoisted.commits[0].revisionId).toBe("rev-1")
    })

    it("tells the button's opening from the palette's", async () => {
        const {result} = renderHook(() => useChatSlashCommands({entityId: "rev-2"}))
        await act(async () => {
            result.current.openModelPicker()
            await vi.advanceTimersByTimeAsync(20)
        })
        expect(result.current.picker).toBe("model")
        expect(result.current.pickerOrigin).toBe("direct")

        act(() => result.current.closePicker())
        const modelRow = result.current.sections
            .flatMap((section) => section.items)
            .find((item) => item.key === "model")
        await act(async () => {
            modelRow?.onSelect?.()
            await vi.advanceTimersByTimeAsync(20)
        })
        expect(result.current.picker).toBe("model")
        expect(result.current.pickerOrigin).toBe("command")
    })
})
