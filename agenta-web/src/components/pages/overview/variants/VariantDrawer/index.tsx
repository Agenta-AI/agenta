import {CloseOutlined, MoreOutlined} from "@ant-design/icons"
import {CloudArrowUp, Lightning, Rocket, Trash} from "@phosphor-icons/react"
import {Badge, Button, Drawer, Dropdown, Tabs, Tag, theme, Typography} from "antd"

import {useAppId} from "@/hooks/useAppId"
import {formatVariantIdWithHash} from "@/lib/helpers/utils"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {useStyles} from "./assets/styles"
import {VariantParametersView, NewVariantParametersView} from "./assets/Parameters"

import type {VariantDrawerProps} from "./types"

const {Title} = Typography
const {useToken} = theme

const VariantDrawer = ({
    selectedVariant,
    environments,
    setIsDeleteEvalModalOpen,
    setIsDeployVariantModalOpen,
    ...props
}: VariantDrawerProps) => {
    const {token} = useToken()
    const classes = useStyles()
    const appId = useAppId()

    return (
        <Drawer
            closeIcon={null}
            width={720}
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
                            <Title>
                                {variantNameWithRev({
                                    variant_name: selectedVariant.variantName,
                                    revision: selectedVariant.revision,
                                })}
                            </Title>
                            <Tag>{formatVariantIdWithHash(selectedVariant.variantId)}</Tag>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            className="flex items-center gap-2"
                            href={`/apps/${appId}/playground?variant=${selectedVariant.variantName}`}
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
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <Typography.Text>Deployment</Typography.Text>
                    <div>
                        {environments.map((env, idx) =>
                            env.deployed_app_variant_id ? (
                                <Tag key={idx}>
                                    <Badge color={token.colorPrimary} text={env.name} />
                                </Tag>
                            ) : (
                                <Tag key={idx}>{env.name}</Tag>
                            ),
                        )}
                    </div>
                </div>
                <div>
                    <Tabs
                        destroyInactiveTabPane
                        defaultActiveKey={"configuration"}
                        items={[
                            {
                                key: "configuration",
                                label: "Configuration",
                                children: selectedVariant.parameters?.ag_config ? (
                                    <NewVariantParametersView selectedVariant={selectedVariant} />
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
