import type {ComponentProps} from "react"
import {useMemo} from "react"

import {Card, Space, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import VariantNameCell from "@/oss/components/VariantNameCell"
import {Environment} from "@/oss/lib/Types"
import {deployedRevisionByEnvironmentAtomFamily} from "@/oss/state/variant/atoms/fetcher"

import EnvironmentTagLabel from "../EnvironmentTagLabel"

import {useDeploymentCardStyles} from "./styles"

type DeploymentCardProps = {
    env: Environment
    selectedEnv?: string
} & ComponentProps<typeof Card>

const DeploymentCard = ({env, selectedEnv, ...props}: DeploymentCardProps) => {
    const classes = useDeploymentCardStyles()

    const envName = env?.name ?? ""
    const revisionAtom = useMemo(() => deployedRevisionByEnvironmentAtomFamily(envName), [envName])
    const revision = useAtomValue(revisionAtom)

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
                borderColor: selectedEnv === env.name ? "#BDC7D1" : undefined,
            }}
            {...props}
        >
            <EnvironmentTagLabel environment={env.name} />

            <Space className="justify-between">
                <Typography.Text>Variant</Typography.Text>
                {revisionId ? (
                    <VariantNameCell revisionId={revisionId} showBadges={false} showStable />
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

export {default as DeploymentCardSkeleton, DEPLOYMENT_SKELETON_ENVIRONMENTS} from "./skeleton"
