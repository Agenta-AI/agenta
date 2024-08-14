import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {fetchEnvironments} from "@/services/deployment/api"
import {MoreOutlined} from "@ant-design/icons"
import {Button, Card, Dropdown, Skeleton, Tag, Typography} from "antd"
import {useRouter} from "next/router"
import {useCallback, useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import DeploymentDrawer from "./DeploymentDrawer"
import {useQueryParam} from "@/hooks/useQuery"
import {Code, Rocket, Swap} from "@phosphor-icons/react"
import ChangeVariantModal from "./ChangeVariantModal"
import {fetchVariants} from "@/services/api"

const {Title, Text} = Typography

interface DeploymentOverviewProps {
    variants: Variant[]
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
        gap: theme.paddingXS,
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
}))

const DeploymentOverview = ({variants}: DeploymentOverviewProps) => {
    const classes = useStyles()
    const router = useRouter()
    const [queryEnv, setQueryEnv] = useQueryParam("environment")
    const appId = router.query.app_id as string
    const [environments, setEnvironments] = useState<Environment[]>([])
    const [selectedEnvironment, setSelectedEnvironment] = useState<Environment>()
    const [isDeploymentLoading, setIsDeploymentLoading] = useState(true)
    const [openChangeVariantModal, setOpenChangeVariantModal] = useState(false)

    const loadEnvironments = useCallback(async () => {
        try {
            setIsDeploymentLoading(true)
            const response = await fetchEnvironments(appId)
            setEnvironments(response)
        } catch (error) {
            console.error(error)
        } finally {
            setIsDeploymentLoading(false)
        }
    }, [appId])

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
                    {environments.map((env, index) => (
                        <Card key={index}>
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        {
                                            key: "use_api",
                                            label: "Use API",
                                            icon: <Code size={16} />,
                                            onClick: () => {
                                                setQueryEnv(env.name)
                                                setSelectedEnvironment(env)
                                            },
                                        },
                                        {
                                            key: "change_variant",
                                            label: "Change Variant",
                                            icon: <Swap size={16} />,
                                            onClick: () => {
                                                setSelectedEnvironment(env)
                                                setOpenChangeVariantModal(true)
                                            },
                                        },
                                        {type: "divider"},
                                        {
                                            key: "open_playground",
                                            label: "Open in playground",
                                            icon: <Rocket size={16} />,
                                            onClick: () =>
                                                router.push(
                                                    `/apps/${appId}/playground?variant=${env.deployed_variant_name}`,
                                                ),
                                        },
                                    ],
                                }}
                            >
                                <Button
                                    type="text"
                                    icon={<MoreOutlined />}
                                    size="small"
                                    className="absolute right-2"
                                />
                            </Dropdown>
                            <Text>{env.name}</Text>
                            {env.deployed_variant_name ? (
                                <Tag className="w-fit" color="green">
                                    {env.deployed_variant_name}
                                </Tag>
                            ) : (
                                <Tag className="w-fit">No deployment</Tag>
                            )}
                        </Card>
                    ))}
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
