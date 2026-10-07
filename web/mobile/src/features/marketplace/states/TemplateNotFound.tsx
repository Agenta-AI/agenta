import {UNAVAILABLE_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"
import Link from "next/link"

/** The catalog loaded without this key, e.g. a link newer than this instance. */
export const TemplateNotFound = ({marketplaceHref}: {marketplaceHref: string}) => (
    <Empty className="py-16">
        <EmptyHeader>
            <EmptyTitle>Template not found</EmptyTitle>
            <EmptyDescription>{UNAVAILABLE_TEMPLATE_MESSAGE}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" asChild>
                <Link href={marketplaceHref}>Browse the marketplace</Link>
            </Button>
        </EmptyContent>
    </Empty>
)
