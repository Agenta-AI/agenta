import {memo, useEffect, useMemo} from "react"

import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Space, Spin, Tag, Typography, TabsProps, Tabs, Switch, Tooltip} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {useRouter} from "next/router"

import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import PlaygroundVariantConfigPrompt from "@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"
import PlaygroundVariantCustomProperties from "@/oss/components/Playground/Components/PlaygroundVariantCustomProperties"
import {PromptsSourceProvider} from "@/oss/components/Playground/context/PromptsSource"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms"
import {parametersOverrideAtomFamily} from "@/oss/components/Playground/state/atoms"
import {variantIsDirtyAtomFamily} from "@/oss/components/Playground/state/atoms/dirtyState"
import UserAvatarTag from "@/oss/components/ui/UserAvatarTag"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {
    derivePromptsFromSpec,
    deriveCustomPropertiesFromSpec,
} from "@/oss/lib/shared/variant/transformer/transformer"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {
    appStatusLoadingAtom,
    revisionDeploymentAtomFamily,
    variantRevisionsQueryFamily,
} from "@/oss/state/variant/atoms/fetcher"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {clearVariantDrawerAtom} from "../../store/variantDrawerStore"
import {variantDrawerAtom} from "../../store/variantDrawerStore"
import {NewVariantParametersView} from "../Parameters"
import {VariantDrawerContentProps} from "../types"
import useURL from "@/oss/hooks/useURL"

const {Text} = Typography

const EMPTY_REVISION_ID = "__variant-drawer-empty__"

const resolveParentVariantId = (variant: any): string | null => {
    if (!variant) return null
    const parent = variant?._parentVariant
    if (typeof parent === "string" && parent.trim()) return parent
    if (parent && typeof parent === "object") return parent.id || parent.variantId || null
    return variant?.variantId ?? null
}

export const drawerVariantIsLoadingAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const schemaLoading = !!get(appStatusLoadingAtom)
        if (!revisionId || revisionId === EMPTY_REVISION_ID) {
            return schemaLoading
        }

        const selectedVariant = get(variantByRevisionIdAtomFamily(revisionId)) as any
        if (!selectedVariant) {
            return true
        }

        const parentVariantId = resolveParentVariantId(selectedVariant)
        if (!parentVariantId) {
            return schemaLoading
        }

        const revisionsQuery = get(variantRevisionsQueryFamily(parentVariantId)) as any
        const data = revisionsQuery?.data
        const hasRevisionData = Array.isArray(data) && data.length > 0

        const revisionLoading =
            !!revisionsQuery?.isLoading || (!hasRevisionData && !!revisionsQuery?.isFetching)

        return schemaLoading || revisionLoading
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
    const {appURL} = useURL()

    const isLoading = useAtomValue(drawerVariantIsLoadingAtomFamily(variantId))

    // Focused selected variant by revision ID
    const selectedVariant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any

    // App-level: app status is true when OpenAPI schema is available
    const appSchema = useAtomValue(appSchemaAtom)
    const appStatus = !!appSchema
    const uriInfo = useAtomValue(appUriInfoAtom)

    const prompts = useAtomValue(promptsAtomFamily(variantId))
    const promptIds = prompts?.map((p: any) => p?.__id as string)

    // Focused deployed environments by revision ID
    const deployedIn = useAtomValue(revisionDeploymentAtomFamily(variantId)) || []
    const commitMsg = selectedVariant?.commitMessage
    const isDirty = useAtomValue(
        variantIsDirtyAtomFamily((selectedVariant as any)?.id || variantId),
    )

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
    ])
    const clearDrawer = useSetAtom(clearVariantDrawerAtom)
    const drawerState = useAtomValue(variantDrawerAtom)
    const [_, setQueryVariant] = useQueryParam("revisions")

    const clearJsonOverride = useSetAtom(
        parametersOverrideAtomFamily((selectedVariant as any)?.id || ""),
    )

    useEffect(() => {
        // Component mount/unmount lifecycle for drawer content
        return () => {
            // In React StrictMode, components mount then immediately unmount once.
            // Only clear when the drawer is actually closed to avoid reopen loops.
            if (!drawerState.open) {
                clearDrawer()
                // Clear URL param after drawer is fully dismissed to prevent content flicker
                const isPlaygroundRoute = router.pathname.includes("/playground")
                if (!isPlaygroundRoute) {
                    setQueryVariant("")
                }
                // Also clear any JSON override draft for this revision when closing the drawer
                clearJsonOverride(null as any)
            }
        }
    }, [clearDrawer, drawerState.open, clearJsonOverride])

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
                                onClick={() =>
                                    router.push({
                                        pathname: `${appURL}/playground`,
                                        query: {
                                            playground: "new-playground",
                                            // Use the actual revision id for navigation
                                            revisions: buildRevisionsQueryParam([
                                                (selectedVariant as any)?.id,
                                            ]),
                                        },
                                    })
                                }
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
                    <Space direction="vertical">
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
