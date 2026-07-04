import {FC} from "react"

import {Card, CardContent} from "@agenta/primitive-ui/components/card"
import {Lock} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Link from "next/link"

import {isBillingEnabled} from "@/oss/lib/helpers/isEE"
import {appIdentifiersAtom} from "@/oss/state/appState/atoms"

interface UpgradePromptProps {
    title: string
    description: string
}

export const UpgradePrompt: FC<UpgradePromptProps> = ({title, description}) => {
    const identifiers = useAtomValue(appIdentifiersAtom)
    const workspaceId = identifiers.workspaceId
    const projectId = identifiers.projectId
    const showBillingLink = isBillingEnabled()

    return (
        <Card>
            <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mb-4 rounded-full bg-muted p-4">
                    <Lock size={32} className="text-muted-foreground" />
                </div>
                <h2 className="mb-2 text-lg font-semibold">{title}</h2>
                <p className="mb-4 max-w-md text-base text-muted-foreground">{description}</p>
                <p className="text-sm text-muted-foreground">
                    Available on <strong>Business</strong> and <strong>Enterprise</strong> plans.{" "}
                    {showBillingLink && workspaceId && projectId && (
                        <Link
                            href={`/w/${workspaceId}/p/${projectId}/settings?tab=billing&upgrade=true`}
                            className="font-medium"
                        >
                            Upgrade plan →
                        </Link>
                    )}
                </p>
            </CardContent>
        </Card>
    )
}
