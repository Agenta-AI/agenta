// @ts-nocheck
import {useMemo} from "react"

import {CloseOutlined, MoreOutlined} from "@ant-design/icons"
import {CloudArrowUp, Lightning, Rocket, Trash} from "@phosphor-icons/react"
import {Badge, Button, Drawer, Dropdown, Space, Tabs, Tag, theme, Typography} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"

import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {formatVariantIdWithHash} from "@/oss/lib/helpers/utils"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {Variant} from "@/oss/lib/Types"

import {VariantParametersView, NewVariantParametersView} from "./assets/Parameters"
import {useStyles} from "./assets/styles"
import type {VariantDrawerProps} from "./types"

const {useToken} = theme

const VariantDrawer = ({
    selectedVariant,
    environments,
    setIsDeleteEvalModalOpen,
    setIsDeployVariantModalOpen,
    ...props
}: VariantDrawerProps) => {
    const router = useRouter()
    const {token} = useToken()
    const classes = useStyles()
    const appId = useAppId()
    const {currentApp} = useAppsData()
    const variantsData = useVariants(currentApp)(
        {
            appId: appId,
        },
        [selectedVariant!],
    )

    const variant = useMemo(() => {
        if (selectedVariant?.children && selectedVariant.children.length) {
            const variantChildren = selectedVariant.children
            return variantChildren[variantChildren.length - 1]
        } else {
            return variantsData?.data?.variants.find((v: Variant) => v.id === selectedVariant.id)
        }
    }, [variantsData?.data?.variants, selectedVariant])

    return (
        <Drawer
            closeIcon={null}
            width={720}
            mask={false}
            destroyOnClose
            {...props}
            title={
                <div className={classes.drawerTitleContainer}>
                    <div className="flex items-center gap-3">
                        <Button
                            onClick={() => props.onClose?.({} as any)}
                            type="text"
                            icon={<CloseOutlined />}
                        />

                        <div className="flex items-center gap-2">
                            <Lightning size={20} />

                            <VariantDetailsWithStatus
                                variantName={selectedVariant.variantName}
                                revision={selectedVariant.revision}
                                variant={selectedVariant}
                            />

                            <Tag>{formatVariantIdWithHash(selectedVariant.variantId)}</Tag>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            className="flex items-center gap-2"
                            onClick={() => {
                                router.push({
                                    pathname: `/apps/${appId}/playground`,
                                    query: selectedVariant
                                        ? {
                                              revisions: JSON.stringify([selectedVariant.id]),
                                          }
                                        : {},
                                })
                            }}
                        >
                            <Rocket size={14} />
                            Playground
                        </Button>
                        <Dropdown
                            trigger={["hover"]}
                            overlayStyle={{width: 180}}
                            menu={{
                                items: [
                                    {
                                        key: "deploy",
                                        label: "Deploy",
                                        icon: <CloudArrowUp size={16} />,
                                        onClick: () => {
                                            props.onClose?.({} as any)
                                            setIsDeployVariantModalOpen(true)
                                        },
                                    },
                                    {
                                        key: "delete",
                                        label: "Delete",
                                        icon: <Trash size={16} />,
                                        onClick: () => {
                                            setIsDeleteEvalModalOpen(true)
                                        },
                                        danger: true,
                                    },
                                ],
                            }}
                        >
                            <Button type="text" icon={<MoreOutlined />} size="small" />
                        </Dropdown>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-6 w-full h-full ">
                {selectedVariant?.revisions ? (
                    <Space direction="vertical">
                        <Typography.Text>Deployment</Typography.Text>
                        <Space>
                            {(
                                selectedVariant.revisions.sort((a, b) => b.revision - a.revision)[0]
                                    .deployedIn || []
                            ).map((env, idx) => (
                                <EnvironmentTagLabel key={idx} environment={env.name} />
                            ))}
                        </Space>
                    </Space>
                ) : selectedVariant?.deployedIn?.length > 0 ? (
                    <Space direction="vertical">
                        <Typography.Text>Deployment</Typography.Text>
                        <Space>
                            {selectedVariant.deployedIn.map((env, idx) => (
                                <EnvironmentTagLabel key={idx} environment={env.name} />
                            ))}
                        </Space>
                    </Space>
                ) : null}
                {/* {} */}
                <div
                    className={clsx([
                        "flex items-center justify-center flex-col",
                        "w-full h-full",
                        "[&_.ant-tabs]:w-full [&_.ant-tabs]:h-full",
                        "[&_.ant-tabs]:grow [&_.ant-tabs]:flex [&_.ant-tabs]:flex-col",
                        "[&_.ant-tabs-content]:grow [&_.ant-tabs-content]:w-full [&_.ant-tabs-content]:h-full",
                    ])}
                >
                    <Tabs
                        destroyInactiveTabPane
                        defaultActiveKey={"configuration"}
                        items={[
                            {
                                key: "configuration",
                                label: "Configuration",
                                className:
                                    "w-full h-full flex items-center justify-center flex-col",
                                children: !variant ? null : variant?.isCustom ||
                                  selectedVariant.parameters?.ag_config ? (
                                    <NewVariantParametersView selectedVariant={variant} />
                                ) : (
                                    <VariantParametersView selectedVariant={selectedVariant} />
                                ),
                            },
                        ]}
                    />
                </div>
            </div>
        </Drawer>
    )
}

export default VariantDrawer
