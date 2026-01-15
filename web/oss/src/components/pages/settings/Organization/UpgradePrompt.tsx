import {FC} from "react"

import {Card, Typography} from "antd"
import {Lock} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Link from "next/link"

import {appIdentifiersAtom} from "@/oss/state/appState/atoms"

const {Title, Text} = Typography

interface UpgradePromptProps {
    title: string
    description: string
}

export const UpgradePrompt: FC<UpgradePromptProps> = ({title, description}) => {
    const identifiers = useAtomValue(appIdentifiersAtom)
    const workspaceId = identifiers.workspaceId
    const projectId = identifiers.projectId

    return (
        <Card>
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="mb-4 p-4 rounded-full bg-[var(--ant-color-fill-quaternary)]">
                    <Lock size={32} className="text-[var(--ant-color-text-tertiary)]" />
                </div>
                <Title level={1} className="!text-lg !mb-2">
                    {title}
                </Title>
                <Text type="secondary" className="!text-base mb-4 max-w-md block">
                    {description}
                </Text>
                <Text type="secondary" className="!text-sm">
                    Available on <strong>Business</strong> and <strong>Enterprise</strong> plans.{" "}
                    {workspaceId && projectId && (
                        <Link
                            href={`/w/${workspaceId}/p/${projectId}/settings?tab=billing&upgrade=true`}
                            className="font-medium"
                        >
                            Upgrade plan →
                        </Link>
                    )}
                </Text>
            </div>
        </Card>
    )
}
