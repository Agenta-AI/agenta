import {memo, useEffect, useMemo} from "react"

import {
    legacyAppRevisionMolecule,
    legacyAppRevisionSchemaQueryAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Space, Spin, Switch, Tabs, TabsProps, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {useRouter} from "next/router"

import UserAvatarTag from "@/oss/components/CustomUIs/UserAvatarTag"
import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import PlaygroundVariantConfigPrompt from "@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"
import PlaygroundVariantCustomProperties from "@/oss/components/Playground/Components/PlaygroundVariantCustomProperties"
import {PromptsSourceProvider} from "@/oss/components/Playground/context/PromptsSource"
import {parametersOverrideAtomFamily} from "@/oss/components/Playground/state/atoms"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"
import {
    deriveCustomPropertiesFromSpec,
    derivePromptsFromSpec,
} from "@/oss/lib/shared/variant/transformer/transformer"
import {
    moleculeBackedPromptsAtomFamily,
    moleculeBackedVariantAtomFamily,
    revisionIsDirtyAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"
import {
    appSchemaAtom,
    appUriInfoAtom,
    revisionDeploymentAtomFamily,
    variantRevisionsQueryFamily,
    revisionsByVariantIdAtomFamily,
} from "@/oss/state/variant/atoms/fetcher"

import {variantDrawerAtom} from "../../store/variantDrawerStore"
import {NewVariantParametersView} from "../Parameters"
import {VariantDrawerContentProps} from "../types"

const {Text} = Typography

const EMPTY_REVISION_ID = "__variant-drawer-empty__"

const resolveParentVariantId = (variant: any): string | null => {
    if (!variant) return null
    const parent = variant?._parentVariant
    if (typeof parent === "string" && parent.trim()) return parent
    if (parent && typeof parent === "object") return parent.id || parent.variantId || null
    return variant?.variantId ?? null
}

/**
 * Loading state atom for drawer variant.
 *
 * The drawer can render prompts and custom properties in two modes:
 * 1. Schema-based (preferred): Uses OpenAPI schema with x-parameters metadata
 * 2. Parameter-based (fallback): Derives from saved parameters structure
 *
 * We should NOT wait for the schema to load if we already have parameters,
 * because prompts can be derived from parameters as a fallback.
 */
export const drawerVariantIsLoadingAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        if (!revisionId || revisionId === EMPTY_REVISION_ID) {
            return true
        }

        const selectedVariant = get(moleculeBackedVariantAtomFamily(revisionId)) as any
        if (!selectedVariant) {
            return true
        }

        // If we have parameters, we can render immediately (prompts will be derived)
        const hasParameters =
            selectedVariant?.parameters && Object.keys(selectedVariant.parameters).length > 0
        if (hasParameters) {
            return false
        }

        // Otherwise, check if URI is available for schema fetch
        const hasUri = !!selectedVariant?.uri

        // If no URI yet, check if revisions are still loading
        if (!hasUri) {
            const parentVariantId = resolveParentVariantId(selectedVariant)
            if (parentVariantId) {
                const revisionsQuery = get(variantRevisionsQueryFamily(parentVariantId)) as any
                const data = revisionsQuery?.data
                const hasRevisionData = Array.isArray(data) && data.length > 0
                const revisionLoading =
                    !!revisionsQuery?.isLoading ||
                    (!hasRevisionData && !!revisionsQuery?.isFetching)
                if (revisionLoading) {
                    return true
                }
            }
        }

        // Check entity-level schema loading only if no parameters yet
        const schemaQuery = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        return schemaQuery.isPending
    }),
)

/**
 * Atom to seed molecule with revision data from OSS atoms.
 * This ensures the revision has URI for entity-level schema fetching.
 */
const seedRevisionDataAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        if (!revisionId || revisionId === EMPTY_REVISION_ID) return null

        // Get current molecule data
        const moleculeData = get(moleculeBackedVariantAtomFamily(revisionId)) as any
        if (moleculeData?.uri) {
            // Already has URI, no need to seed
            return moleculeData
        }

        // Try to find revision in OSS atoms (which have URI from variant)
        const parentVariantId = resolveParentVariantId(moleculeData)
        if (!parentVariantId) return moleculeData

        const revisions = get(revisionsByVariantIdAtomFamily(parentVariantId)) as any[]
        const ossRevision = revisions?.find((r: any) => r.id === revisionId)

        if (ossRevision?.uri) {
            // Return merged data with URI from OSS
            return {
                ...moleculeData,
                uri: ossRevision.uri,
                variantId: ossRevision.variantId ?? moleculeData?.variantId,
                variantName: ossRevision.variantName ?? moleculeData?.variantName,
                appId: ossRevision.appId ?? moleculeData?.appId,
            }
        }

        return moleculeData
    }),
)

const VariantDrawerContent = ({
    variantId,
    type,
    viewAs,
    onChangeViewAs,
    showOriginal,
    onToggleOriginal,
}: VariantDrawerContentProps) => {
    const router = useRouter()
    const {goToPlayground} = usePlaygroundNavigation()

    const isLoading = useAtomValue(drawerVariantIsLoadingAtomFamily(variantId))

    // Use seeded revision data that includes URI from OSS atoms
    const selectedVariant = useAtomValue(seedRevisionDataAtomFamily(variantId)) as any

    // App-level: app status is true when OpenAPI schema is available
    const appSchema = useAtomValue(appSchemaAtom)
    const uriInfo = useAtomValue(appUriInfoAtom)

    const prompts = useAtomValue(moleculeBackedPromptsAtomFamily(variantId))
    const promptIds = prompts?.map((p: any) => p?.__id as string)

    // Show Overview tab if we have app schema OR if we have prompts/variant data
    // This allows the drawer to work even when app context isn't fully set up
    const appStatus = !!appSchema || (promptIds && promptIds.length > 0) || !!selectedVariant

    // Focused deployed environments by revision ID
    const deployedIn = useAtomValue(revisionDeploymentAtomFamily(variantId)) || []
    const commitMsg = selectedVariant?.commitMessage
    const isDirty = useAtomValue(
        revisionIsDirtyAtomFamily((selectedVariant as any)?.id || variantId),
    )

    // Seed molecule with revision data from OSS atoms (includes URI for schema fetch)
    // This ensures the entity-level schema query can access the URI
    const parentVariantId = resolveParentVariantId(selectedVariant)
    const ossRevisions = useAtomValue(
        useMemo(
            () => (parentVariantId ? revisionsByVariantIdAtomFamily(parentVariantId) : atom([])),
            [parentVariantId],
        ),
    ) as any[]

    useEffect(() => {
        if (!variantId || variantId === EMPTY_REVISION_ID) return
        if (!ossRevisions || ossRevisions.length === 0) return

        const ossRevision = ossRevisions.find((r: any) => r.id === variantId)
        if (!ossRevision?.uri) return

        // Check if molecule already has URI
        const currentData = legacyAppRevisionMolecule.get.serverData(variantId)
        if (currentData?.uri) return

        // Seed molecule with revision data including URI
        const dataToSeed = {
            id: variantId,
            variantId: ossRevision.variantId,
            variantName: ossRevision.variantName,
            appId: ossRevision.appId,
            uri: ossRevision.uri,
            revision: ossRevision.revision,
            parameters: ossRevision.parameters ?? ossRevision.config?.parameters,
            commitMessage: ossRevision.commitMessage ?? ossRevision.commit_message,
            createdAt: ossRevision.createdAt,
            updatedAt: ossRevision.updatedAt,
            modifiedById: ossRevision.modifiedById ?? ossRevision.modified_by_id,
        }

        legacyAppRevisionMolecule.set.serverData(variantId, dataToSeed)
    }, [variantId, ossRevisions])

    // Ensure clean revisions don't get stuck in Original mode
    useEffect(() => {
        if (!isDirty && showOriginal) {
            onToggleOriginal?.(false)
        }
    }, [isDirty, showOriginal, onToggleOriginal])

    // Derive original (saved) prompts from spec and saved parameters for read-only view
    const originalPrompts = useMemo(() => {
        try {
            if (!showOriginal) return [] as any[]
            if (!appSchema || !selectedVariant) return [] as any[]
            const routePath = uriInfo?.routePath
            const derived = derivePromptsFromSpec(
                selectedVariant as any,
                appSchema as any,
                routePath,
            )
            return Array.isArray(derived) ? (derived as any[]) : []
        } catch {
            return [] as any[]
        }
    }, [showOriginal, appSchema, selectedVariant, uriInfo?.routePath])

    const originalPromptIds = useMemo(
        () => originalPrompts.map((p: any) => p.__id || p.__name).filter(Boolean),
        [originalPrompts],
    )

    // Derive original (saved) custom properties for read-only view
    const originalCustomPropsRecord = useMemo(() => {
        try {
            if (!showOriginal) return {}
            if (!appSchema || !selectedVariant) return {}
            const routePath = uriInfo?.routePath
            const record = deriveCustomPropertiesFromSpec(
                selectedVariant as any,
                appSchema as any,
                routePath,
            ) as Record<string, any>
            return record || {}
        } catch {
            return {}
        }
    }, [showOriginal, appSchema, selectedVariant, uriInfo?.routePath])

    const disableOriginalPromptCollapse = originalPromptIds.length === 1
    const disablePromptCollapse = (promptIds?.length || 0) === 1

    const tabItems = useMemo(() => {
        return [
            appStatus
                ? {
                      key: "main",
                      label: type === "variant" ? "Overview" : "Variant",
                      className: "w-full h-full flex flex-col px-4",

                      children: showOriginal ? (
                          <PromptsSourceProvider
                              promptsByRevision={{
                                  [(selectedVariant as any)?.id || variantId]: originalPrompts,
                              }}
                          >
                              <>
                                  {originalPromptIds.map((promptId: string) => (
                                      <PlaygroundVariantConfigPrompt
                                          key={promptId}
                                          promptId={promptId}
                                          variantId={(selectedVariant as any)?.id || variantId}
                                          className="[&_.ant-collapse-content-box>div>div]:!w-[97%] border border-solid border-[#0517290F]"
                                          viewOnly
                                          disableCollapse={disableOriginalPromptCollapse}
                                      />
                                  ))}
                                  <PlaygroundVariantCustomProperties
                                      variantId={(selectedVariant as any)?.id || variantId}
                                      initialOpen={originalPromptIds.length === 0}
                                      viewOnly
                                      customPropsRecord={originalCustomPropsRecord}
                                  />
                              </>
                          </PromptsSourceProvider>
                      ) : (
                          <>
                              {(promptIds || [])?.map((promptId: string) => (
                                  <PlaygroundVariantConfigPrompt
                                      key={promptId}
                                      promptId={promptId}
                                      variantId={selectedVariant?.id}
                                      className="[&_.ant-collapse-content-box>div>div]:!w-[97%] border border-solid border-[#0517290F]"
                                      disableCollapse={disablePromptCollapse}
                                  />
                              ))}

                              <PlaygroundVariantCustomProperties
                                  variantId={selectedVariant?.id}
                                  initialOpen={promptIds?.length === 0}
                              />
                          </>
                      ),
                  }
                : undefined,
            {
                key: "json",
                label: "JSON",
                className: "h-full flex flex-col px-4",
                children: isLoading ? null : selectedVariant ? (
                    <NewVariantParametersView
                        selectedVariant={selectedVariant}
                        showOriginal={showOriginal}
                    />
                ) : null,
            },
        ].filter(Boolean) as TabsProps["items"]
    }, [
        appStatus,
        selectedVariant,
        promptIds,
        type,
        showOriginal,
        originalPrompts,
        originalPromptIds,
        isLoading,
        disableOriginalPromptCollapse,
        disablePromptCollapse,
    ])
    const drawerState = useAtomValue(variantDrawerAtom)
    const clearJsonOverride = useSetAtom(
        parametersOverrideAtomFamily((selectedVariant as any)?.id || ""),
    )

    useEffect(() => {
        // Component mount/unmount lifecycle for drawer content
        return () => {
            // In React StrictMode, components mount then immediately unmount once.
            // Only clear when the drawer is actually closed to avoid reopen loops.
            if (!drawerState.open) {
                const isPlaygroundRoute = router.pathname.includes("/playground")
                if (!isPlaygroundRoute) {
                    clearJsonOverride(null as any)
                }
            }
        }
    }, [clearJsonOverride, drawerState.open, router.pathname])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <Spin spinning />
            </div>
        )
    }

    return (
        <section className="flex w-full h-full overflow-hidden">
            <div
                className={clsx([
                    "flex flex-col gap-6 w-full h-full",
                    {"items-center justify-center": isLoading},
                ])}
            >
                <div
                    className={clsx([
                        "flex items-center justify-center flex-col",
                        "w-full h-full",
                        "[&_.ant-tabs]:w-full [&_.ant-tabs]:h-full",
                        "[&_.ant-tabs]:grow [&_.ant-tabs]:flex [&_.ant-tabs]:flex-col",
                        "[&_.ant-tabs-content]:grow [&_.ant-tabs-content]:w-full [&_.ant-tabs-content]:h-full",
                        "[&_.ant-tabs-nav-wrap]:!px-4 [&_.ant-tabs-nav]:sticky [&_.ant-tabs-nav]:top-[0px] [&_.ant-tabs-nav]:z-40 [&_.ant-tabs-nav]:bg-white",
                    ])}
                >
                    <Tabs
                        destroyOnHidden
                        activeKey={!appStatus ? "json" : viewAs === "parameters" ? "json" : "main"}
                        onChange={(key) => onChangeViewAs(key === "json" ? "parameters" : "prompt")}
                        className="overflow-auto"
                        tabBarExtraContent={{
                            right: (
                                <div className="flex items-center gap-2 pr-4">
                                    <Text type="secondary">Original</Text>
                                    <Tooltip title={!isDirty ? "No local changes" : undefined}>
                                        <Switch
                                            size="small"
                                            checked={!!showOriginal}
                                            onChange={(checked) => onToggleOriginal?.(checked)}
                                            disabled={!isDirty}
                                        />
                                    </Tooltip>
                                </div>
                            ),
                        }}
                        items={tabItems}
                    />
                </div>
            </div>

            <div className="w-[300px] h-full border-0 border-l border-solid border-[#0517290F] shrink-0 p-4 gap-4 flex flex-col items-start">
                <Text className="font-medium">Detail</Text>

                {type === "deployment" && (
                    <div className="w-full flex flex-col gap-1">
                        <Text className="font-medium">Variant</Text>
                        <div className="w-full flex items-center justify-between gap-1">
                            <VariantDetailsWithStatus
                                variantName={selectedVariant?.variantName}
                                revision={selectedVariant?.revision}
                                variant={selectedVariant}
                            />
                            <Button
                                icon={<ArrowSquareOut size={16} />}
                                size="small"
                                onClick={() => goToPlayground((selectedVariant as any)?.id)}
                            />
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <Text className="font-medium">Date modified</Text>
                    <Tag bordered={false} className="bg-[#0517290F]">
                        {(() => {
                            const ts =
                                (selectedVariant as any)?.updatedAtTimestamp ??
                                (selectedVariant as any)?.createdAtTimestamp
                            return ts
                                ? formatDate24(ts)
                                : ((selectedVariant as any)?.createdAt ?? "-")
                        })()}
                    </Tag>
                </div>
                <div className="flex flex-col gap-1">
                    <Text className="font-medium">Modified by</Text>
                    {/* Pass the revision id so selector can resolve modifiedBy correctly */}
                    <UserAvatarTag variantId={(selectedVariant as any)?.id} />
                </div>

                {commitMsg && (
                    <div className="flex flex-col gap-1">
                        <Text className="font-medium">Note</Text>
                        <Text>{commitMsg}</Text>
                    </div>
                )}

                {deployedIn?.length > 0 && (
                    <Space orientation="vertical">
                        <Text className="font-medium">Deployment</Text>
                        <div className="flex flex-col gap-1">
                            {deployedIn.map((env, idx) => (
                                <EnvironmentTagLabel key={idx} environment={env.name} />
                            ))}
                        </div>
                    </Space>
                )}
            </div>
        </section>
    )
}

export default memo(VariantDrawerContent)
