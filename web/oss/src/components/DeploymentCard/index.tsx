import type {ComponentProps} from "react"

import {Card, Space, Tag, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Environment, JSSTheme} from "@/oss/lib/Types"

import EnvironmentTagLabel, {deploymentStatusColors} from "../EnvironmentTagLabel"
import Version from "../Playground/assets/Version"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    deploymentCard: {
        cursor: "pointer",
        width: "100%",
        transition: "all 0.25s ease-in",
        position: "relative",
        "& .ant-card-body": {
            padding: theme.paddingSM,
            display: "flex",
            flexDirection: "column",
            gap: theme.paddingXS,
            "&:before": {
                display: "none",
            },
            "& > span.ant-typography:first-of-type": {
                textTransform: "capitalize",
            },
        },
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
            borderColor: "var(--hover-border-color)",
        },
    },
}))

type DeploymentCardProps = {
    selectedDeployedVariant: EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>> | undefined
    env: Environment
    selectedEnv?: string
} & ComponentProps<typeof Card>

const DeploymentCard = ({
    selectedDeployedVariant,
    env,
    selectedEnv,
    ...props
}: DeploymentCardProps) => {
    const classes = useStyles()

    const getBorderColor = (envName: string) =>
        deploymentStatusColors[envName.toLowerCase()].textColor

    return (
        <Card
            className={classes.deploymentCard}
            style={{
                borderColor: selectedEnv === env.name ? getBorderColor(env.name) : undefined,
                // @ts-ignore
                "--hover-border-color": getBorderColor(env.name),
            }}
            {...props}
        >
            <EnvironmentTagLabel environment={env.name} />

            <Space className="justify-between">
                <Typography.Text>Variant</Typography.Text>
                {env.deployed_variant_name ? (
                    <Space>
                        <Typography.Text>{env.deployed_variant_name}</Typography.Text>
                        <Version revision={env.revision || 0} />
                    </Space>
                ) : (
                    <Tag onClick={(e) => e.stopPropagation()}>No deployment</Tag>
                )}
            </Space>
            <Space className="justify-between">
                <Typography.Text>Last modified</Typography.Text>
                <Typography.Text>{selectedDeployedVariant?.updatedAt || "-"}</Typography.Text>
            </Space>
        </Card>
    )
}

export default DeploymentCard
