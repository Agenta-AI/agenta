import {useState, useCallback, useMemo, useRef} from "react"

import {environmentsListQueryAtomFamily} from "@agenta/entities/environment"
import {publishMutationAtom} from "@agenta/entities/runnable"
import {
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
    workflowsListDataAtom,
} from "@agenta/entities/workflow"
import {CommitMessageInput} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {textColors} from "@agenta/ui/styles"
import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {Typography} from "antd"
import {getDefaultStore} from "jotai"
import {useAtomValue, useSetAtom} from "jotai"

import type {RegistryRevisionRow} from "@/oss/components/VariantsComponents/store/registryStore"
import {registryPaginatedStore} from "@/oss/components/VariantsComponents/store/registryStore"
import {createRegistryColumns} from "@/oss/components/VariantsComponents/Table/assets/registryColumns"
import {routerAppIdAtom} from "@/oss/state/app"

import {
    closeSelectDeployVariantModalAtom,
    selectDeployVariantStateAtom,
} from "./store/deploymentModalsStore"

const {Text} = Typography
const EMPTY_ACTIONS = {}

/** Resolve the currently deployed revision info for an environment + app */
function useCurrentDeployment(envName: string, appId: string | null) {
    const envQuery = useAtomValue(environmentsListQueryAtomFamily(false))

    return useMemo(() => {
        if (!appId || !envName) return null
        const envs = envQuery.data?.environments ?? []
        const env = envs.find(
            (e) =>
                e.name === envName ||
                e.slug === envName ||
                e.name?.toLowerCase() === envName.toLowerCase(),
        )
        if (!env?.data?.references) return null

        const refs = env.data.references as Record<
            string,
            {
                application?: {id?: string}
                application_variant?: {id?: string; slug?: string}
                application_revision?: {id?: string; version?: string}
            }
        >

        for (const ref of Object.values(refs)) {
            if (ref?.application?.id === appId) {
                const revisionId = ref.application_revision?.id
                const version = ref.application_revision?.version
                const variantId = ref.application_variant?.id
                // Resolve variant display name from the variant entity list
                const store = getDefaultStore()
                const workflowData = revisionId ? workflowMolecule.get.data(revisionId) : null
                const workflowId = workflowData?.workflow_id || appId
                const variants = workflowId
                    ? store.get(workflowVariantsListDataAtomFamily(workflowId))
                    : []
                const variantEntity = variants.find((v) => v.id === variantId)
                const variantName = variantEntity?.name || variantEntity?.slug || workflowData?.slug
                return {
                    revisionId: revisionId ?? null,
                    variantName: variantName || "unknown",
                    version: workflowData?.version ?? (version ? Number(version) : null),
                }
            }
        }
        return null
    }, [appId, envName, envQuery.data])
}

export const useSelectDeployVariant = () => {
    const state = useAtomValue(selectDeployVariantStateAtom)
    const close = useSetAtom(closeSelectDeployVariantModalAtom)
    const {mutateAsync: publish, isPending} = useAtomValue(publishMutationAtom)
    const appId = useAtomValue(routerAppIdAtom)

    const [selectedRowKeys, setSelectedRowKeys] = useState<(string | number)[]>([])
    const [note, setNote] = useState("")
    // Ref to hold the selected row data — set by the content component
    const selectedRowRef = useRef<RegistryRevisionRow | null>(null)

    const currentDeployment = useCurrentDeployment(state.envName, appId)
    const isAlreadyDeployed =
        !!selectedRowKeys.length &&
        !!currentDeployment?.revisionId &&
        selectedRowKeys[0] === currentDeployment.revisionId

    const handleDeploy = useCallback(async () => {
        const row = selectedRowRef.current
        if (!row) return

        const envName = state.envName

        // Resolve application slug from the workflows list
        const store = getDefaultStore()
        const workflows = store.get(workflowsListDataAtom)
        const workflowEntity = workflows.find((w) => w.id === row.workflowId)
        const applicationSlug = workflowEntity?.slug || workflowEntity?.name || undefined

        try {
            await publish({
                revisionId: row.revisionId,
                environmentSlug: envName,
                applicationId: row.workflowId || appId || "",
                workflowVariantId: row.variantId || undefined,
                variantSlug: row.variantName || undefined,
                applicationSlug,
                revisionVersion: row.version ?? undefined,
                note,
            })
            message.success(`Deployed to ${envName} successfully`)
            close()
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "Deployment failed"
            message.error(errorMessage)
        }
    }, [state.envName, publish, appId, note, close])

    return {
        close,
        isPending,
        isAlreadyDeployed,
        currentDeployment,
        selectedRowKeys,
        setSelectedRowKeys,
        selectedRowRef,
        note,
        setNote,
        handleDeploy,
    }
}

const VariantLabel = ({name, version}: {name: string; version: number | string | null}) => (
    <span className="flex items-center gap-1 min-w-0">
        <span className={`truncate ${textColors.secondary}`} title={name}>
            {name}
        </span>
        {version != null && <VersionBadge version={version} variant="chip" className="shrink-0" />}
    </span>
)

const SelectDeployVariantModalContent = ({
    selectedRowKeys,
    setSelectedRowKeys,
    selectedRowRef,
    note,
    setNote,
    envName,
    currentDeployment,
}: {
    selectedRowKeys: (string | number)[]
    setSelectedRowKeys: (keys: (string | number)[]) => void
    selectedRowRef: React.MutableRefObject<RegistryRevisionRow | null>
    note: string
    setNote: (note: string) => void
    envName: string
    currentDeployment: {
        revisionId: string | null
        variantName: string
        version: number | null
    } | null
}) => {
    const table = useTableManager<RegistryRevisionRow>({
        datasetStore: registryPaginatedStore.store as never,
        scopeId: "deploy-variant-selector",
        pageSize: 50,
        rowClassName: "variant-table-row",
        search: {placeholder: "Search revisions...", className: "w-[300px]"},
    })

    const columns = useMemo(() => createRegistryColumns(EMPTY_ACTIONS), [])

    const rowSelection = useMemo(
        () => ({
            type: "radio" as const,
            selectedRowKeys: selectedRowKeys as React.Key[],
            onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as (string | number)[]),
        }),
        [selectedRowKeys, setSelectedRowKeys],
    )

    // Resolve selected revision details for the context panel + deploy action
    const selectedRow = useMemo(() => {
        if (!selectedRowKeys.length) {
            selectedRowRef.current = null
            return null
        }
        const key = selectedRowKeys[0]
        const row = table.rows.find((r) => r.key === key) ?? null
        selectedRowRef.current = row
        return row
    }, [selectedRowKeys, table.rows, selectedRowRef])

    return (
        <div className="flex flex-row gap-4 overflow-hidden h-[500px]">
            {/* Left: context + deploy message */}
            <div className="w-[280px] shrink-0 flex flex-col gap-4 overflow-y-auto">
                {/* Deploy context panel */}
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    {selectedRow ? (
                        <>
                            <Text className={textColors.secondary}>
                                This will deploy the following revision to{" "}
                                <span className="font-medium capitalize">{envName}</span>.
                            </Text>
                            <div className="mt-2 flex items-center gap-2 min-w-0">
                                {currentDeployment ? (
                                    <>
                                        <VariantLabel
                                            name={currentDeployment.variantName}
                                            version={currentDeployment.version}
                                        />
                                        <span className={`shrink-0 ${textColors.tertiary}`}>→</span>
                                    </>
                                ) : null}
                                <VariantLabel
                                    name={selectedRow.variantName}
                                    version={selectedRow.version}
                                />
                            </div>
                            {selectedRow.model && (
                                <div className={`mt-1 text-xs ${textColors.tertiary}`}>
                                    Model: {selectedRow.model}
                                </div>
                            )}
                            {currentDeployment?.revisionId === selectedRowKeys[0] && (
                                <div className="mt-2 text-xs text-amber-600">
                                    This revision is already deployed to {envName}.
                                </div>
                            )}
                        </>
                    ) : (
                        <Text className={textColors.secondary}>
                            Select a revision from the table to deploy to{" "}
                            <span className="font-medium capitalize">{envName}</span>.
                        </Text>
                    )}
                </div>

                <CommitMessageInput value={note} onChange={setNote} label="Deploy message" />
            </div>

            {/* Right: revision table — fixed height prevents infinite growth in modal */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <InfiniteVirtualTableFeatureShell<RegistryRevisionRow>
                    {...table.shellProps}
                    columns={columns}
                    rowSelection={rowSelection}
                    enableExport={false}
                    autoHeight
                />
            </div>
        </div>
    )
}

export default SelectDeployVariantModalContent
