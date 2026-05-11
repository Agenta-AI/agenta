import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {workflowAppTypeAtomFamily} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {createStandardColumns} from "@agenta/ui/table"
import {ArrowCounterClockwise, Note, Rocket, Trash} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {getAppTypeIcon} from "../../prompts/assets/iconHelpers"
import type {AppWorkflowRow} from "../store"

/**
 * Read the derived app type from the default Jotai store.
 *
 * Table cells render inside InfiniteVirtualTable's isolated Jotai provider,
 * so `useAtomValue` would read from an empty store where sessionAtom and
 * projectIdAtom are never set. Reading from the default store ensures we
 * access the app-level atoms where these values are populated.
 */
const useWorkflowAppType = (workflowId: string) => {
    const store = getDefaultStore()
    return useAtomValue(workflowAppTypeAtomFamily(workflowId), {store})
}

export const AppTypeCell = ({workflowId}: {workflowId: string}) => {
    const appType = useWorkflowAppType(workflowId)

    return <WorkflowTypeTag isEvaluator={false} workflowType={appType} />
}

export const AppNameCell = ({workflowId, name}: {workflowId: string; name: string}) => {
    const appType = useWorkflowAppType(workflowId)

    return (
        <div className="h-full flex items-center gap-2 truncate">
            <span className="flex-shrink-0 flex items-center text-gray-400">
                {getAppTypeIcon(appType ?? undefined)}
            </span>
            <span className="truncate">{name}</span>
        </div>
    )
}

export interface AppWorkflowColumnActions {
    onOpen: (record: AppWorkflowRow) => void
    onOpenPlayground: (record: AppWorkflowRow) => void
    onDelete: (record: AppWorkflowRow) => void
    onRestore?: (record: AppWorkflowRow) => void
}

export interface AppWorkflowColumnOptions {
    mode?: "active" | "archived"
}

export function createAppWorkflowColumns(
    actions: AppWorkflowColumnActions,
    {mode = "active"}: AppWorkflowColumnOptions = {},
) {
    const isArchived = mode === "archived"

    return createStandardColumns<AppWorkflowRow>([
        {
            type: "text",
            key: "name",
            title: "Name",
            render: (_, record) => (
                <AppNameCell workflowId={record.workflowId} name={record.name} />
            ),
        },
        {
            type: "date",
            key: "createdAt",
            title: "Created At",
        },
        {
            type: "text",
            key: "appType",
            title: "Type",
            render: (_, record) => (
                <div className="h-full flex items-center">
                    <AppTypeCell workflowId={record.workflowId} />
                </div>
            ),
        },
        ...(isArchived
            ? ([
                  {
                      type: "date",
                      key: "deletedAt",
                      title: "Archived At",
                  },
                  {
                      type: "text",
                      key: "deletedById",
                      title: "Archived By",
                      render: (_: unknown, record: AppWorkflowRow) => (
                          <div className="h-full flex items-center">
                              <UserAuthorLabel
                                  userId={record.deletedById}
                                  showPrefix={false}
                                  showAvatar
                                  showYouLabel
                              />
                          </div>
                      ),
                  },
              ] as const)
            : []),
        {
            type: "actions",
            items: isArchived
                ? [
                      {
                          key: "open_app",
                          label: "Open overview",
                          icon: <Note size={16} />,
                          onClick: (record) => actions.onOpen(record),
                      },
                      {type: "divider"},
                      {
                          key: "restore_app",
                          label: "Restore",
                          icon: <ArrowCounterClockwise size={16} />,
                          onClick: (record) => actions.onRestore?.(record),
                      },
                  ]
                : [
                      {
                          key: "open_app",
                          label: "Open overview",
                          icon: <Note size={16} />,
                          onClick: (record) => actions.onOpen(record),
                      },
                      {
                          key: "open_playground",
                          label: "Open in playground",
                          icon: <Rocket size={16} />,
                          onClick: (record) => actions.onOpenPlayground(record),
                      },
                      {type: "divider"},
                      {
                          key: "delete_app",
                          label: "Archive",
                          icon: <Trash size={16} />,
                          danger: true,
                          onClick: (record) => actions.onDelete(record),
                      },
                  ],
            showCopyId: false,
        },
    ])
}
