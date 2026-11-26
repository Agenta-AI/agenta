import {atom, type Atom} from "jotai"

/**
 * Stand-ins for the data the wizard's step tables read, so a render test controls the apps, the
 * revisions, the test sets and the evaluators. The start hook has its own test over the real
 * stores.
 */
export interface MockApp {
    id: string
    name: string
    slug?: string
    created_at?: string
    flags?: Record<string, boolean>
}

export interface MockRevisionRow {
    revisionId: string
    workflowId: string
    variantId: string
    variantName: string
    variantSlug: string | null
    version: number
    model: string
    message: string | null
    createdAt: string | null
    createdById: string | null
}

export interface MockTestset {
    id: string
    name: string
    created_at: string | null
    created_by_id: string | null
}

export interface MockEvaluator {
    workflow: {id: string; name: string; slug?: string}
    latestRevision: Record<string, unknown>
}

export const wizardData = {
    apps: [] as MockApp[],
    appTypes: {} as Record<string, string>,
    appsPending: false,
    appsError: false,
    refetchApps: () => undefined as unknown,
    revisions: [] as MockRevisionRow[],
    latestRevisionId: null as string | null,
    testsets: [] as MockTestset[],
    testsetRevisions: {} as Record<string, {id: string; version: number; message: string | null}>,
    evaluators: {automatic: [] as MockEvaluator[], human: [] as MockEvaluator[]},
    evaluatorRevisions: [] as Record<string, unknown>[],
    evaluatorsPending: false,
    evaluatorsError: false,
    refetchEvaluators: () => undefined as unknown,
    revisionData: {} as Record<string, unknown>,
    /** The search each table last asked for, by table. */
    searches: {} as Record<string, string>,
}

const appsStateAtom = atom(() => ({
    data: wizardData.apps,
    isPending: wizardData.appsPending,
    isError: wizardData.appsError,
    error: null,
}))
const appsQueryAtom = atom(() => ({refetch: () => wizardData.refetchApps()}))
const memo = <T,>(build: (id: string) => Atom<T>) => {
    const atoms = new Map<string, Atom<T>>()
    return (id: string) => {
        const existing = atoms.get(id)
        if (existing) return existing
        const created = build(id)
        atoms.set(id, created)
        return created
    }
}
const dataAtom = memo((id) => atom<unknown>(() => wizardData.revisionData[id] ?? null))
const appTypeAtom = memo((id) => atom(() => wizardData.appTypes[id] ?? null))
const latestRevisionIdAtom = memo(() => atom(() => wizardData.latestRevisionId))
const templatesAtom = atom(() => [{key: "auto_exact_match", categories: ["classifiers"]}])

export const workflowOverrides = {
    appWorkflowsListQueryStateAtom: appsStateAtom,
    appWorkflowsListQueryAtom: appsQueryAtom,
    workflowMolecule: {selectors: {data: dataAtom}},
    workflowAppTypeAtomFamily: appTypeAtom,
    workflowLatestRevisionIdAtomFamily: latestRevisionIdAtom,
    evaluatorTemplatesDataAtom: templatesAtom,
}

export const appRevisionsMock = {
    useAppRevisions: ({search}: {search: string}) => {
        wizardData.searches.revisions = search
        return {
            rows: wizardData.revisions,
            isPending: false,
            isError: false,
            hasMore: false,
            isLoadingMore: false,
            loadMore: () => undefined,
            refetch: () => undefined,
        }
    },
}

export const testsetsListMock = {
    useTestsetsList: ({search}: {search: string}) => {
        wizardData.searches.testsets = search
        return {
            testsets: wizardData.testsets,
            isPending: false,
            isError: false,
            refetch: () => undefined,
            hasMore: false,
            loadMore: () => undefined,
            isLoadingMore: false,
        }
    },
}

export const testsetRevisionsMock = {
    useTestsetLatestRevisions: () => new Map(Object.entries(wizardData.testsetRevisions)),
}

export const evaluatorsMock = {
    useEvaluatorEntries: ({category}: {category: "automatic" | "human"}) => ({
        entries: wizardData.evaluators[category],
        isPending: wizardData.evaluatorsPending,
        isError: wizardData.evaluatorsError,
        refetch: () => wizardData.refetchEvaluators(),
    }),
}

export const evaluatorRevisionsMock = {
    useEvaluatorRevisions: () => ({
        revisions: wizardData.evaluatorRevisions,
        isPending: false,
        isError: false,
        hasMore: false,
        isLoadingMore: false,
        loadMore: () => undefined,
        refetch: () => undefined,
    }),
}

/** The variant label without its deployment lookups: name, version, and the latest tag. */
export const variantUiMock = {
    VariantDetailsWithStatus: (props: {
        variantName?: string
        revision: number
        isLatest?: boolean
    }) => (
        <span>
            {props.variantName} v{props.revision}
            {props.isLatest ? " Last modified" : ""}
        </span>
    ),
}

/** The type and kind tags as plain text, without the template catalog. */
export const workflowUiMock = {
    WorkflowTypeTag: (props: {workflowType?: string | null; workflowKey?: string | null}) => (
        <span>{props.workflowType ?? props.workflowKey ?? ""}</span>
    ),
    WorkflowKindTag: ({isEvaluator}: {isEvaluator: boolean}) => (
        <span>{isEvaluator ? "Evaluator" : "App"}</span>
    ),
}

export const revisionRow = (
    revisionId: string,
    variantName: string,
    version: number,
    extra: Partial<MockRevisionRow> = {},
): MockRevisionRow => ({
    revisionId,
    workflowId: "app-1",
    variantId: `variant-${variantName}`,
    variantName,
    variantSlug: variantName,
    version,
    model: "gpt-4o-mini",
    message: null,
    createdAt: "2026-11-05T10:00:00Z",
    createdById: null,
    ...extra,
})

export const humanEvaluator = (id: string, name: string, keys: string[]): MockEvaluator => ({
    workflow: {id, name},
    latestRevision: {
        id: `${id}-rev-1`,
        workflow_id: id,
        version: 1,
        flags: {is_feedback: true},
        data: {
            uri: "agenta:custom:feedback:v0",
            schemas: {
                outputs: {
                    type: "object",
                    properties: Object.fromEntries(keys.map((key) => [key, {type: "string"}])),
                },
            },
        },
    },
})

export const autoEvaluator = (id: string, name: string, versions = 1): MockEvaluator => ({
    workflow: {id, name},
    latestRevision: {
        id: `${id}-rev-${versions}`,
        workflow_id: id,
        version: versions,
        message: "Tighten the match",
        data: {uri: "agenta:builtin:auto_exact_match:v0"},
    },
})

export const resetWizardData = () => {
    wizardData.apps = []
    wizardData.appTypes = {}
    wizardData.appsPending = false
    wizardData.appsError = false
    wizardData.refetchApps = () => undefined
    wizardData.revisions = []
    wizardData.latestRevisionId = null
    wizardData.testsets = []
    wizardData.testsetRevisions = {}
    wizardData.evaluators = {automatic: [], human: []}
    wizardData.evaluatorRevisions = []
    wizardData.evaluatorsPending = false
    wizardData.evaluatorsError = false
    wizardData.refetchEvaluators = () => undefined
    wizardData.revisionData = {}
    wizardData.searches = {}
}
