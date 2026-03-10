import {Flask, Lightning} from "@phosphor-icons/react"

export interface EntityTypeIconProps {
    entityType?: string | null
    size?: number
    className?: string
    appClassName?: string
    evaluatorClassName?: string
}

export function EntityTypeIcon({
    entityType,
    size = 14,
    className,
    appClassName = "text-blue-500",
    evaluatorClassName = "text-purple-500",
}: EntityTypeIconProps) {
    if (entityType === "evaluatorRevision") {
        return <Flask size={size} weight="fill" className={evaluatorClassName || className} />
    }
    return <Lightning size={size} weight="fill" className={appClassName || className} />
}
