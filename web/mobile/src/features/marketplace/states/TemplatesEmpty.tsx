import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {LayoutGrid} from "lucide-react"

/** The catalog loaded with no templates at all; nothing to clear. */
export const TemplatesEmpty = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <LayoutGrid />
            </EmptyMedia>
            <EmptyTitle>No templates yet</EmptyTitle>
            <EmptyDescription>This version of Agenta ships no agent templates.</EmptyDescription>
        </EmptyHeader>
    </Empty>
)
