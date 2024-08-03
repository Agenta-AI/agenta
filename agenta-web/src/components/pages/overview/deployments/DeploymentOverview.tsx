import {Environment, JSSTheme} from "@/lib/Types"
import {fetchEnvironments} from "@/services/deployment/api"
import {MoreOutlined} from "@ant-design/icons"
import {Button, Card, Dropdown, Tag, Typography} from "antd"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import DeploymentDrawer from "./DeploymentDrawer"
import {useQueryParam} from "@/hooks/useQuery"

const {Title, Text} = Typography

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

const DeploymentOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const [queryEnv, setQueryEnv] = useQueryParam("environment")
    const appId = router.query.app_id as string
    const [environments, setEnvironments] = useState<Environment[]>([])
    const [selectedEnvironment, setSelectedEnvironment] = useState<Environment>()

    const loadEnvironments = async () => {
        try {
            const response = await fetchEnvironments(appId)
            setEnvironments(response)
        } catch (error) {
            console.error(error)
        }
    }

    useEffect(() => {
        if (appId) {
            loadEnvironments()
        }
    }, [appId])

    return (
        <div className={classes.container}>
            <Title>Deployment</Title>

            <div className={classes.cardContainer}>
                {environments.map((env, index) => (
                    <Card key={index}>
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    {
                                        key: "view-details",
                                        label: "View Details",
                                        onClick: () => {
                                            setQueryEnv(env.name)
                                            setSelectedEnvironment(env)
                                        },
                                        disabled: !env.deployed_app_variant_id,
                                    },
                                    {
                                        key: "change_variant",
                                        label: "Change Variant",
                                    },
                                    {type: "divider"},
                                    {
                                        key: "open_playground",
                                        label: "Open in playground",
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

            <DeploymentDrawer
                selectedEnvironment={selectedEnvironment}
                open={!!queryEnv}
                onClose={() => setQueryEnv("")}
            />
        </div>
    )
}

export default DeploymentOverview
