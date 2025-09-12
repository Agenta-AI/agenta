import type {ComponentProps} from "react"
import {useMemo} from "react"

import {Card, Space, Tag, Typography} from "antd"
import {getDefaultStore} from "jotai"
import {createUseStyles} from "react-jss"

import VariantNameCell from "@/oss/components/VariantNameCell"
import {Environment, JSSTheme} from "@/oss/lib/Types"
import {deployedRevisionByEnvironmentAtomFamily} from "@/oss/state/variant/atoms/fetcher"

import EnvironmentTagLabel, {deploymentStatusColors} from "../EnvironmentTagLabel"

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
    env: Environment
    selectedEnv?: string
} & ComponentProps<typeof Card>

const store = getDefaultStore()
const DeploymentCard = ({
    env,
    selectedEnv,
    selectedDeployedVariant,
    ...props
}: DeploymentCardProps) => {
    const classes = useStyles()

    const getBorderColor = (envName: string) =>
        deploymentStatusColors[envName.toLowerCase()].textColor

    // Always pass a valid atom to Jotai hooks; fallback to a noop atom when no revisionId
    const revision = useMemo(() => {
        return store.get(deployedRevisionByEnvironmentAtomFamily((env as any)?.name))
    }, [env])

    const revisionId = revision?.id

    let lastModifiedText = "-"
    if (revision) {
        const ts = (revision as any)?.updatedAtTimestamp ?? (revision as any)?.createdAtTimestamp
        if (typeof ts === "number") {
            try {
                lastModifiedText = new Date(ts).toLocaleString()
            } catch {
                lastModifiedText = String(ts)
            }
        } else {
            lastModifiedText = (revision as any)?.updatedAt ?? (revision as any)?.createdAt ?? "-"
        }
    }

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
                {revisionId ? (
                    <VariantNameCell revisionId={revisionId} showBadges={false} />
                ) : (
                    <Tag onClick={(e) => e.stopPropagation()}>No deployment</Tag>
                )}
            </Space>
            <Space className="justify-between">
                <Typography.Text>Last modified</Typography.Text>
                <Typography.Text>{lastModifiedText}</Typography.Text>
            </Space>
        </Card>
    )
}

export default DeploymentCard
