import {useAppId} from "@/hooks/useAppId"
import {filterVariantParameters} from "@/lib/helpers/utils"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {CloseOutlined, MoreOutlined} from "@ant-design/icons"
import {CloudArrowUp, Lightning, Rocket, Trash} from "@phosphor-icons/react"
import {Badge, Button, Drawer, Dropdown, Tabs, Tag, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

type VariantDrawerProps = {
    selectedVariant: Variant
    environments: Environment[]
    setIsDeleteEvalModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setIsDeployVariantModalOpen: React.Dispatch<React.SetStateAction<boolean>>
} & React.ComponentProps<typeof Drawer>

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    drawerTitleContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading5,
            lineHeight: theme.lineHeightHeading5,
            fontWeight: 500,
        },
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: 500,
    },
    resultTag: {
        minWidth: 150,
        display: "flex",
        borderRadius: theme.borderRadiusSM,
        border: `1px solid ${theme.colorBorder}`,
        textAlign: "center",
        "& > div:nth-child(1)": {
            backgroundColor: "rgba(0, 0, 0, 0.02)",
            lineHeight: theme.lineHeight,
            flex: 1,
            minWidth: 50,
            borderRight: `1px solid ${theme.colorBorder}`,
            padding: "0 7px",
        },
        "& > div:nth-child(2)": {
            padding: "0 7px",
        },
    },
    promptTextField: {
        padding: theme.paddingXS,
        backgroundColor: theme.colorBgContainerDisabled,
        borderRadius: theme.borderRadius,
    },
    noParams: {
        color: theme.colorTextDescription,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 200,
    },
    drawerTabs: {
        "& .ant-tabs-content-holder": {
            maxHeight: 700,
            overflowY: "scroll",
        },
    },
}))

const VariantDrawer = ({
    selectedVariant,
    environments,
    setIsDeleteEvalModalOpen,
    setIsDeployVariantModalOpen,
    ...props
}: VariantDrawerProps) => {
    const classes = useStyles()
    const appId = useAppId()

    return (
        <Drawer
            closeIcon={null}
            width={560}
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
                            <Tag>#161661</Tag>
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
                                    <Badge color="blue" text={env.name} />
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
                        className={classes.drawerTabs}
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
                                                                <div
                                                                    className={classes.resultTag}
                                                                    key={index}
                                                                >
                                                                    <div>{key}</div>
                                                                    <div>
                                                                        {JSON.stringify(value)}
                                                                    </div>
                                                                </div>
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
