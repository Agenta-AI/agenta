import {useMemo} from "react"

import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Space, Spin, Tabs, Tag, Typography, TabsProps} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"

import Avatar from "@/oss/components/Avatar/Avatar"
import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import PlaygroundVariantConfigPrompt from "@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"
import PlaygroundVariantCustomProperties from "@/oss/components/Playground/Components/PlaygroundVariantCustomProperties"
import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {useAppId} from "@/oss/hooks/useAppId"

import {NewVariantParametersView} from "../Parameters"
import {VariantDrawerContentProps} from "../types"

const {Text} = Typography

const VariantDrawerContent = ({
    selectedVariant,
    promptIds,
    isLoading,
    type,
    variants,
    onChangeViewAs,
}: VariantDrawerContentProps) => {
    const router = useRouter()
    const appId = useAppId()

    const {appStatus, mutateVariant} = usePlayground({
        variantId: selectedVariant?.id,
        stateSelector: (state) => {
            return {
                appStatus: state.appStatus,
            }
        },
    })

    const deployedIn = useMemo(() => {
        if (type !== "variant") return []

        if (variants[0]?.revisions && variants[0]?.revisions?.length > 0) {
            return (
                variants.find((v) => v?.id === selectedVariant?._parentVariant?.id)?.deployedIn ||
                []
            )
        }

        return selectedVariant?.deployedIn || []
    }, [type, variants, selectedVariant])

    const tabItems = useMemo(() => {
        return [
            appStatus
                ? {
                      key: type === "variant" ? "overview" : "variant",
                      label: (
                          <div onClick={() => onChangeViewAs("prompt")}>
                              {type === "variant" ? "Overview" : "Variant"}
                          </div>
                      ),
                      className: "w-full h-full flex flex-col px-4",

                      children: (
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
                label: <div onClick={() => onChangeViewAs("parameters")}>JSON</div>,
                className: "h-full flex flex-col px-4",
                children: selectedVariant ? (
                    <NewVariantParametersView
                        selectedVariant={selectedVariant}
                        mutateVariant={mutateVariant}
                    />
                ) : null,
            },
        ].filter(Boolean) as TabsProps["items"]
    }, [selectedVariant, promptIds, type, onChangeViewAs])

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
                        destroyInactiveTabPane
                        defaultActiveKey={type === "variant" ? "overview" : "variant"}
                        className="overflow-auto"
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
                                        pathname: `/apps/${appId}/playground`,
                                        query: {
                                            playground: "new-playground",
                                            revisions: JSON.stringify([
                                                (selectedVariant as any)?._revisionId,
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
                        {selectedVariant?.updatedAt}
                    </Tag>
                </div>
                <div className="flex flex-col gap-1">
                    <Text className="font-medium">Modified by</Text>
                    <Tag bordered={false} className="bg-[#0517290F]">
                        <Avatar name={selectedVariant?.modifiedBy} className="w-4 h-4 text-[9px]" />{" "}
                        {selectedVariant?.modifiedBy}
                    </Tag>
                </div>

                {selectedVariant?.commitMessage && (
                    <div className="flex flex-col gap-1">
                        <Text className="font-medium">Note</Text>
                        <Text>{selectedVariant?.commitMessage || ""}</Text>
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

export default VariantDrawerContent
