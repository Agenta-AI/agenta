import type {ReactNode} from "react"

import type {Folder} from "@agenta/entities/workflow"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"

import type {PromptsDialog} from "./promptDialogState"
import type {PromptsRow} from "./promptRow"
import type {PromptRowActions} from "./promptRowActions"
import {PromptsBreadcrumb} from "./PromptsBreadcrumb"
import {promptsCopy} from "./promptsCopy"
import {PromptsList} from "./PromptsList"
import {PromptsEmpty} from "./states/PromptsEmpty"
import type {NewPromptAction} from "./useCreatePrompt"
import type {PromptsEmptyKind} from "./usePromptsBrowser"

/**
 * The page body: the breadcrumb, the search box and the list or its error. It holds no data
 * hooks, so a story can draw every state from plain props.
 */
export const PromptsView = ({
    chain,
    siblingsOf,
    rows,
    search,
    onSearchChange,
    isPending,
    isError,
    emptyKind,
    canEditFolders,
    canEditPrompts,
    rowActions,
    onOpenFolder,
    openDialog,
    newPrompt,
    onRetry,
}: {
    chain: Folder[]
    siblingsOf: (parentId: string | null) => Folder[]
    rows: PromptsRow[]
    search: string
    onSearchChange: (term: string) => void
    isPending: boolean
    isError: boolean
    emptyKind: PromptsEmptyKind | null
    canEditFolders: boolean
    canEditPrompts: boolean
    rowActions: PromptRowActions
    onOpenFolder: (id: string | null) => void
    openDialog: (dialog: PromptsDialog) => void
    /** New prompt in the folder menu; null without developer mode. */
    newPrompt: NewPromptAction | null
    onRetry: () => void
}): ReactNode => (
    <>
        <PromptsBreadcrumb
            chain={chain}
            siblingsOf={siblingsOf}
            canEditFolders={canEditFolders}
            onOpenFolder={onOpenFolder}
            openDialog={openDialog}
            newPrompt={newPrompt}
        />
        <ListTableToolbar
            search={search}
            onSearchChange={onSearchChange}
            searchPlaceholder={promptsCopy.searchPlaceholder}
        />
        {isError ? (
            <LoadError framed title={promptsCopy.states.loadErrorTitle} onRetry={onRetry} />
        ) : (
            <PromptsList
                rows={rows}
                isLoading={isPending}
                empty={
                    emptyKind ? (
                        <PromptsEmpty kind={emptyKind} onClearSearch={() => onSearchChange("")} />
                    ) : null
                }
                canEditFolders={canEditFolders}
                canEditPrompts={canEditPrompts}
                actions={rowActions}
            />
        )}
    </>
)
