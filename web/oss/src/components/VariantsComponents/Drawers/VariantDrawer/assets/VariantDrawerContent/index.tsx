import {memo, useEffect, useMemo} from "react"

import {
    legacyAppRevisionSchemaQueryAtomFamily,
    revisionEnhancedCustomPropertiesAtomFamily,
    revisionEnhancedPromptsAtomFamily,
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
import {playgroundRevisionDeploymentAtomFamily} from "@/oss/components/Playground/state/atoms/playgroundAppAtoms"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"
import {
    moleculeBackedPromptsAtomFamily,
    moleculeBackedVariantAtomFamily,
    revisionIsDirtyAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"

import {variantDrawerAtom} from "../../store/variantDrawerStore"
import {NewVariantParametersView} from "../Parameters"
import {VariantDrawerContentProps} from "../types"

const {Text} = Typography

const EMPTY_REVISION_ID = "__variant-drawer-empty__"

/**
 * Loading state atom for drawer variant.
 *
 * Waits for both variant data AND schema before rendering, so prompts and
 * custom properties are derived with full metadata on first paint.
 * For completion/chat apps the schema is prefetched, so this adds no latency.
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

        const schemaQuery = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        return schemaQuery.isPending
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

    const selectedVariant = useAtomValue(moleculeBackedVariantAtomFamily(variantId)) as any

    const prompts = useAtomValue(moleculeBackedPromptsAtomFamily(variantId))
    const promptIds = prompts?.map((p: any) => p?.__id as string)

    // Original (server-committed) prompts and custom properties from entity layer
    const originalPrompts = useAtomValue(revisionEnhancedPromptsAtomFamily(variantId)) as any[]
    const originalCustomPropsRecord = useAtomValue(
        revisionEnhancedCustomPropertiesAtomFamily(variantId),
    ) as Record<string, any>

    const originalPromptIds = useMemo(
        () => (originalPrompts || []).map((p: any) => p.__id || p.__name).filter(Boolean),
        [originalPrompts],
    )

    // Show Overview tab if we have prompts or variant data
    const appStatus = (promptIds && promptIds.length > 0) || !!selectedVariant

    // Focused deployed environments by revision ID
    const deployedIn = useAtomValue(playgroundRevisionDeploymentAtomFamily(variantId)) || []
    const commitMsg = selectedVariant?.commitMessage
    const isDirty = useAtomValue(
        revisionIsDirtyAtomFamily((selectedVariant as any)?.id || variantId),
    )

    // Ensure clean revisions don't get stuck in Original mode
    useEffect(() => {
        if (!isDirty && showOriginal) {
            onToggleOriginal?.(false)
        }
    }, [isDirty, showOriginal, onToggleOriginal])

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
        originalCustomPropsRecord,
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
