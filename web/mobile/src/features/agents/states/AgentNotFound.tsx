import {Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia} from "@agenta/ui/ui"
import {LockSimpleIcon} from "@phosphor-icons/react"
import Link from "next/link"

import {sharingCopy} from "@/lib/sharingCopy"

/** An agent the reader cannot open: the same page for a private and an unknown agent. */
export const AgentNotFound = ({agentsHref}: {agentsHref: string}) => (
    <Empty className="m-auto py-16" data-testid="agent-not-found">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <LockSimpleIcon />
            </EmptyMedia>
            <EmptyDescription>{sharingCopy.agentNotFound}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
            <Button variant="outline" size="sm" asChild>
                <Link href={agentsHref}>{sharingCopy.backToAgents}</Link>
            </Button>
        </EmptyContent>
    </Empty>
)
