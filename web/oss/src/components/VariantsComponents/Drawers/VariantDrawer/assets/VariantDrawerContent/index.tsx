import {memo, useEffect, useMemo} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {PlaygroundConfigSection} from "@agenta/entity-ui/drill-in"
import {FormattedDate} from "@agenta/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Space, Spin, Switch, Tabs, TabsProps, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import OSSdrillInUIProvider from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"

import {NewVariantParametersView} from "../Parameters"
import {VariantDrawerContentProps} from "../types"

const {Text} = Typography

const EMPTY_REVISION_ID = "__variant-drawer-empty__"

/**
 * Loading state atom for drawer variant.
 *
 * When data cannot be loaded (e.g., deleted revision, API error), returns false
 * so the drawer can render a "not found" state instead of loading forever.
 */
export const drawerVariantIsLoadingAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        if (!revisionId || revisionId === EMPTY_REVISION_ID) {
            return true
        }

        const entity = get(workflowMolecule.selectors.data(revisionId))
        if (!entity) {
            const query = get(workflowMolecule.atoms.query(revisionId))
            if (!query.isPending) {
                return false
            }
            return true
        }

        return false
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
    const {goToPlayground} = usePlaygroundNavigation()
    const resolvedVariantId = variantId || EMPTY_REVISION_ID

    const isLoading = useAtomValue(drawerVariantIsLoadingAtomFamily(resolvedVariantId))
    const workflowData = useAtomValue(workflowMolecule.selectors.data(resolvedVariantId))

    const revisionId = workflowData?.id || resolvedVariantId

    // Show Overview tab if we have variant data
    const appStatus = !!workflowData

    // Focused deployed environments by revision ID
    const deployedIn = useAtomValue(environmentMolecule.atoms.revisionDeployment(revisionId))
    const commitMsg = workflowData?.message
    const isDirty = useAtomValue(
        workflowMolecule.selectors.isDirty(revisionId || resolvedVariantId),
    )

    // Ensure clean revisions don't get stuck in Original mode
    useEffect(() => {
        if (!isDirty && showOriginal) {
            onToggleOriginal?.(false)
        }
    }, [isDirty, showOriginal, onToggleOriginal])

    const tabItems = useMemo(() => {
        return [
            appStatus
                ? {
                      key: "main",
                      label: type === "variant" ? "Overview" : "Variant",
                      className: "w-full h-full flex flex-col px-4",
                      children: (
                          <OSSdrillInUIProvider>
                              <PlaygroundConfigSection
                                  revisionId={revisionId}
                                  disabled={!!showOriginal}
                                  useServerData={!!showOriginal}
                              />
                          </OSSdrillInUIProvider>
                      ),
                  }
                : undefined,
            {
                key: "json",
                label: "JSON",
                className: "h-full flex flex-col px-4",
                children: isLoading ? null : (
                    <NewVariantParametersView revisionId={revisionId} showOriginal={showOriginal} />
                ),
            },
        ].filter(Boolean) as TabsProps["items"]
    }, [appStatus, revisionId, type, showOriginal, isLoading])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <Spin spinning />
            </div>
        )
    }

    if (!workflowData) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <Text type="secondary">Revision not found</Text>
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
                                variantName={workflowData.name}
                                revision={workflowData.version}
                                variant={workflowData}
                            />
                            <Button
                                icon={<ArrowSquareOut size={16} />}
                                size="small"
                                onClick={() => goToPlayground(revisionId)}
                            />
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <Text className="font-medium">Date modified</Text>
                    <FormattedDate
                        date={workflowData.updated_at ?? workflowData.created_at}
                        asTag
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Text className="font-medium">Modified by</Text>
                    <UserAuthorLabel userId={workflowData.updated_by_id} showPrefix={false} />
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
