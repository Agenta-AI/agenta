import {CaretLeft} from "@phosphor-icons/react"
import Link from "next/link"

/** The muted link above a skill page's title. */
export const SkillBackLink = ({
    href,
    label,
    onClick,
}: {
    href: string
    label: string
    onClick?: (event: React.MouseEvent) => void
}) => (
    <Link
        href={href}
        onClick={onClick}
        className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground no-underline hover:text-foreground"
    >
        <CaretLeft size={14} />
        {label}
    </Link>
)
