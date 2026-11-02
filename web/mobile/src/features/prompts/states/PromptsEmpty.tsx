import {Button, Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {FolderOpenIcon, MagnifyingGlassIcon} from "@phosphor-icons/react"

import {promptsCopy} from "../promptsCopy"
import type {PromptsEmptyKind} from "../usePromptsBrowser"

const TITLES: Record<PromptsEmptyKind, string> = {
    project: promptsCopy.states.emptyProject,
    folder: promptsCopy.states.emptyFolder,
    search: promptsCopy.states.noMatch,
}

/** Nothing to list: an empty project, an empty folder, or a search that matched nothing. */
export const PromptsEmpty = ({
    kind,
    onClearSearch,
}: {
    kind: PromptsEmptyKind
    onClearSearch?: () => void
}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                {kind === "search" ? <MagnifyingGlassIcon /> : <FolderOpenIcon />}
            </EmptyMedia>
            <EmptyTitle>{TITLES[kind]}</EmptyTitle>
        </EmptyHeader>
        {kind === "search" && onClearSearch ? (
            <EmptyContent>
                <Button size="sm" variant="outline" onClick={onClearSearch}>
                    Clear search
                </Button>
            </EmptyContent>
        ) : null}
    </Empty>
)
