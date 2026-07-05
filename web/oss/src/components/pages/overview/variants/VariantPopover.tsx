import {useState} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {useUserDisplayName} from "@agenta/entities/shared/user"
import type {Workflow} from "@agenta/entities/workflow"
import {VariantNameCell} from "@agenta/entity-ui/variant"
import {statusVariantMap} from "@agenta/entity-ui/variant"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Flex} from "antd"

import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {formatVariantIdWithHash} from "@/oss/lib/helpers/utils"

interface VariantPopoverProps {
    env: AppEnvironmentDeployment
    selectedDeployedVariant: Workflow | undefined
}

const ModifiedByText = ({variant}: {variant: Workflow}) => {
    const authorId = variant.updated_by_id ?? variant.created_by_id ?? null
    const resolvedName = useUserDisplayName(authorId ?? undefined)
    if (!resolvedName || resolvedName === "-") return null
    return <span className="font-normal">{resolvedName}</span>
}

const VariantPopover = ({env, selectedDeployedVariant}: VariantPopoverProps) => {
    const {goToPlayground} = usePlaygroundNavigation()
    const [open, setOpen] = useState(false)

    return (
        <Popover
            open={open}
            onOpenChange={(nextOpen, eventDetails) => {
                if (eventDetails.reason === "trigger-press") return
                setOpen(nextOpen)
            }}
        >
            <PopoverTrigger
                nativeButton={false}
                openOnHover
                delay={100}
                closeDelay={100}
                render={
                    <Badge
                        className="w-fit cursor-pointer py-[1px] px-2"
                        onClick={(e) => e.stopPropagation()}
                        variant="secondary"
                    >
                        <Badge variant={statusVariantMap[env.name] ?? "secondary"} dot>
                            {formatVariantIdWithHash(env.deployedRevisionId as string)}
                        </Badge>
                    </Badge>
                }
            />
            <PopoverContent side="bottom" align="center" className="w-auto min-w-64 max-w-[360px]">
                <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-4">
                    <Flex justify="space-between">
                        <VariantNameCell revisionId={selectedDeployedVariant?.id} showBadges />

                        <Button
                            className="flex items-center justify-center"
                            onClick={() => {
                                goToPlayground(env.deployedRevisionId)
                            }}
                            variant="outline"
                            size="icon-sm"
                        >
                            {<ArrowSquareOut size={14} />}
                        </Button>
                    </Flex>
                    {selectedDeployedVariant && (
                        <ModifiedByText variant={selectedDeployedVariant} />
                    )}
                    {selectedDeployedVariant?.message && (
                        <span className="text-muted-foreground">
                            {selectedDeployedVariant?.message}
                        </span>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}

export default VariantPopover
