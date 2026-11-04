import {atom, type Atom} from "jotai"

/**
 * Stand-ins for the data the wizard's sections read, so a render test controls the app list, the
 * evaluator counts and the picker. The start hook has its own test over the real stores.
 */
export interface MockApp {
    id: string
    name: string
    slug?: string
    flags?: Record<string, boolean>
}

export const wizardData = {
    apps: [] as MockApp[],
    appsPending: false,
    appsError: false,
    evaluatorCount: 0,
    evaluatorsPending: false,
    evaluatorsError: false,
    refetchEvaluators: () => undefined as unknown,
    revisionData: {} as Record<string, unknown>,
    refetchApps: () => undefined as unknown,
}

export const pickers = {
    latest: {} as Record<string, Record<string, unknown>>,
    adapters: [] as unknown[],
}

const appsStateAtom = atom(() => ({
    data: wizardData.apps,
    isPending: wizardData.appsPending,
    isError: wizardData.appsError,
    error: null,
}))
const appsQueryAtom = atom(() => ({refetch: () => wizardData.refetchApps()}))
const evaluatorsListAtom = atom(() => ({
    data: {refs: new Array(wizardData.evaluatorCount).fill({})},
    isPending: wizardData.evaluatorsPending,
    isError: wizardData.evaluatorsError,
    refetch: () => wizardData.refetchEvaluators(),
}))
const metaMapAtom = atom(() => new Map())
const dataAtoms = new Map<string, Atom<unknown>>()
const dataAtom = (id: string) => {
    const existing = dataAtoms.get(id)
    if (existing) return existing
    const created = atom<unknown>(() => wizardData.revisionData[id] ?? null)
    dataAtoms.set(id, created)
    return created
}
const nameAtoms = new Map<string, Atom<string | null>>()
const nameAtom = (id: string) => {
    const existing = nameAtoms.get(id)
    if (existing) return existing
    const created = atom<string | null>(() => (id === "ev-rev-1" ? "Helpfulness" : null))
    nameAtoms.set(id, created)
    return created
}

export const workflowOverrides = {
    appWorkflowsListQueryStateAtom: appsStateAtom,
    appWorkflowsListQueryAtom: appsQueryAtom,
    evaluatorsListQueryAtom: evaluatorsListAtom,
    evaluatorWorkflowMetaMapAtom: metaMapAtom,
    workflowMolecule: {selectors: {data: dataAtom, artifactName: nameAtom}},
}

export const selectionMock = {
    EntityPicker: (props: Record<string, unknown>) => {
        pickers.latest[String(props.instanceId)] = props
        return <div data-picker={String(props.instanceId)} />
    },
    createWorkflowRevisionAdapter: (options: Record<string, unknown>) => ({
        kind: "revision",
        options,
    }),
    testsetAdapter: {kind: "testset"},
    useEnrichedEvaluatorOnlyAdapter: () => ({kind: "auto"}),
    useEnrichedHumanEvaluatorAdapter: () => ({kind: "human"}),
    useEnsureEvaluatorEnrichment: () => undefined,
}

export const resetWizardData = () => {
    wizardData.apps = []
    wizardData.appsPending = false
    wizardData.appsError = false
    wizardData.evaluatorCount = 0
    wizardData.evaluatorsPending = false
    wizardData.evaluatorsError = false
    wizardData.refetchEvaluators = () => undefined
    wizardData.revisionData = {}
    wizardData.refetchApps = () => undefined
    pickers.latest = {}
}
