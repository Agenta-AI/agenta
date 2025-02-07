import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {MoreOutlined} from "@ant-design/icons"
import {Button, Card, Dropdown, Skeleton, Tag, Typography} from "antd"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import DeploymentDrawer from "./DeploymentDrawer"
import {useQueryParam} from "@/hooks/useQuery"
import {Code, Rocket, Swap} from "@phosphor-icons/react"
import ChangeVariantModal from "./ChangeVariantModal"
import VariantPopover from "../variants/VariantPopover"

const {Title, Text} = Typography

interface DeploymentOverviewProps {
    variants: Variant[]
    isDeploymentLoading: boolean
    environments: Environment[]
    loadEnvironments: () => Promise<void>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingXS,
        "& > h1.ant-typography": {
            fontSize: theme.fontSize,
        },
    },
    cardContainer: {
        display: "flex",
        gap: theme.padding,
        "& .ant-card": {
            width: "100%",
            position: "relative",
            "& .ant-card-body": {
                padding: theme.padding,
                display: "flex",
                flexDirection: "column",
                gap: theme.paddingXS,
                "& > span.ant-typography:first-of-type": {
                    textTransform: "capitalize",
                },
            },
        },
    },
    deploymentCard: {
        cursor: "pointer",
        transition: "all 0.025s ease-in",
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
        },
    },
}))

const DeploymentOverview = ({
    variants,
    isDeploymentLoading,
    environments,
    loadEnvironments,
}: DeploymentOverviewProps) => {
    const classes = useStyles()
    const router = useRouter()
    const [queryEnv, setQueryEnv] = useQueryParam("environment")
    const appId = router.query.app_id as string
    const [selectedEnvironment, setSelectedEnvironment] = useState<Environment>()
    const [openChangeVariantModal, setOpenChangeVariantModal] = useState(false)

    useEffect(() => {
        if (!appId) return
        loadEnvironments()
    }, [appId, loadEnvironments])

    return (
        <div className={classes.container}>
            <Title>Deployment</Title>

            {isDeploymentLoading ? (
                <div className="flex gap-2">
                    {Array.from({length: 3}).map((_, index) => (
                        <Skeleton key={index} />
                    ))}
                </div>
            ) : (
                <div className={classes.cardContainer}>
                    {environments.map((env, index) => {
                        const selectedDeployedVariant = variants?.find(
                            (variant) => variant?.variantId === env.deployed_app_variant_id,
                        )

                        return (
                            <Card
                                key={index}
                                onClick={() => {
                                    setQueryEnv(env.name)
                                    setSelectedEnvironment(env)
                                }}
                                className={classes.deploymentCard}
                            >
                                <Dropdown
                                    trigger={["click"]}
                                    menu={{
                                        items: [
                                            {
                                                key: "use_api",
                                                label: "Use API",
                                                icon: <Code size={16} />,
                                                onClick: (e) => {
                                                    e.domEvent.stopPropagation()
                                                    setQueryEnv(env.name)
                                                    setSelectedEnvironment(env)
                                                },
                                            },
                                            {
                                                key: "change_variant",
                                                label: "Change Variant",
                                                icon: <Swap size={16} />,
                                                onClick: (e) => {
                                                    e.domEvent.stopPropagation()
                                                    setSelectedEnvironment(env)
                                                    setOpenChangeVariantModal(true)
                                                },
                                            },
                                            {type: "divider"},
                                            {
                                                key: "open_playground",
                                                label: "Open in playground",
                                                icon: <Rocket size={16} />,
                                                onClick: (e) => {
                                                    e.domEvent.stopPropagation()
                                                    if (env.deployed_variant_name) {
                                                        router.push(
                                                            `/apps/${appId}/playground?variant=${env.deployed_variant_name}`,
                                                        )
                                                    } else {
                                                        router.push(`/apps/${appId}/playground`)
                                                    }
                                                },
                                            },
                                        ],
                                    }}
                                >
                                    <Button
                                        type="text"
                                        onClick={(e) => e.stopPropagation()}
                                        icon={<MoreOutlined />}
                                        className="absolute right-2"
                                    />
                                </Dropdown>
                                <Text>{env.name}</Text>
                                {env.deployed_variant_name ? (
                                    <VariantPopover
                                        selectedDeployedVariant={selectedDeployedVariant}
                                        env={env}
                                    />
                                ) : (
                                    <Tag
                                        className="w-fit py-[1px] px-2"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        No deployment
                                    </Tag>
                                )}
                            </Card>
                        )
                    })}
                </div>
            )}

            {selectedEnvironment && (
                <DeploymentDrawer
                    selectedEnvironment={selectedEnvironment}
                    open={!!queryEnv}
                    onClose={() => setQueryEnv("")}
                    variants={variants}
                    loadEnvironments={loadEnvironments}
                    setQueryEnv={setQueryEnv}
                    setOpenChangeVariantModal={setOpenChangeVariantModal}
                />
            )}

            {selectedEnvironment && (
                <ChangeVariantModal
                    open={openChangeVariantModal}
                    setOpenChangeVariantModal={setOpenChangeVariantModal}
                    onCancel={() => setOpenChangeVariantModal(false)}
                    variants={variants}
                    selectedEnvironment={selectedEnvironment}
                    loadEnvironments={loadEnvironments}
                />
            )}
        </div>
    )
}

export default DeploymentOverview
