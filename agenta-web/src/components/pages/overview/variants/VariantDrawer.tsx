import ResultTag from "@/components/ResultTag/ResultTag"
import {useAppId} from "@/hooks/useAppId"
import {filterVariantParameters, formatVariantIdWithHash} from "@/lib/helpers/utils"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {CloseOutlined, MoreOutlined} from "@ant-design/icons"
import {CloudArrowUp, Lightning, Rocket, Trash} from "@phosphor-icons/react"
import {Badge, Button, Drawer, Dropdown, Tabs, Tag, theme, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

type VariantDrawerProps = {
    selectedVariant: Variant
    environments: Environment[]
    setIsDeleteEvalModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setIsDeployVariantModalOpen: React.Dispatch<React.SetStateAction<boolean>>
} & React.ComponentProps<typeof Drawer>

const {Title} = Typography
const {useToken} = theme

const useStyles = createUseStyles((theme: JSSTheme) => ({
    drawerTitleContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading5,
            lineHeight: theme.lineHeightHeading5,
            fontWeight: theme.fontWeightMedium,
        },
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    promptTextField: {
        padding: theme.paddingXS,
        backgroundColor: theme.colorBgContainerDisabled,
        borderRadius: theme.borderRadius,
    },
    noParams: {
        color: theme.colorTextDescription,
        fontWeight: theme.fontWeightMedium,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 200,
    },
}))

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
                                children: (
                                    <div>
                                        {" "}
                                        {selectedVariant.parameters &&
                                        Object.keys(selectedVariant.parameters).length ? (
                                            <div className="flex flex-col gap-6">
                                                <div className="flex flex-col gap-2">
                                                    <Typography.Text className={classes.subTitle}>
                                                        Parameters
                                                    </Typography.Text>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        {selectedVariant.parameters &&
                                                            Object.entries(
                                                                filterVariantParameters({
                                                                    record: selectedVariant.parameters,
                                                                    key: "prompt",
                                                                    include: false,
                                                                }),
                                                            ).map(([key, value], index) => (
                                                                <ResultTag
                                                                    key={index}
                                                                    title={key}
                                                                    value={value}
                                                                />
                                                            ))}
                                                    </div>
                                                </div>

                                                {selectedVariant.parameters &&
                                                    Object.entries(
                                                        filterVariantParameters({
                                                            record: selectedVariant.parameters,
                                                            key: "prompt",
                                                        }),
                                                    ).map(([key, value], index) => (
                                                        <div
                                                            className="flex flex-col gap-2"
                                                            key={index}
                                                        >
                                                            <Typography.Text
                                                                className={classes.subTitle}
                                                            >
                                                                {key}
                                                            </Typography.Text>
                                                            <div
                                                                className={classes.promptTextField}
                                                            >
                                                                {JSON.stringify(value)}
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        ) : (
                                            <Typography.Text className={classes.noParams}>
                                                No Parameters
                                            </Typography.Text>
                                        )}
                                    </div>
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
