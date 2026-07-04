import {useCallback, useEffect, useMemo, useState} from "react"

import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@agenta/primitive-ui/components/alert-dialog"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {ArrowClockwise, Copy, GearSix, Plus, Trash, WarningCircle} from "@phosphor-icons/react"

import {useLoading} from "@/oss/hooks/useLoading"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {APIKey} from "@/oss/lib/Types"
import {createApiKey, deleteApiKey, fetchAllListApiKeys} from "@/oss/services/apiKeys/api"
import {useOrgData} from "@/oss/state/org"

import {Loading} from "./assets/constants"

const monospaceKeyClass =
    "font-mono tracking-[0.08em] [font-variant-ligatures:none] inline-block rounded border border-border bg-muted px-2 py-1 leading-none"

const APIKeys: React.FC = () => {
    const [keys, setKeys] = useState<APIKey[]>([])
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [pendingDeletePrefix, setPendingDeletePrefix] = useState<string | null>(null)
    const [createdKey, setCreatedKey] = useState<string | null>(null)
    const [loading, setLoading] = useLoading(Object.values(Loading))
    const {canEditApiKeys, canViewApiKeys} = useProjectPermissions()

    const {selectedOrg} = useOrgData()
    const workspaceId: string = selectedOrg?.default_workspace?.id || ""

    const listKeys = useCallback(() => {
        if (!canViewApiKeys) {
            setKeys([])
            return
        }

        if (!workspaceId || workspaceId.trim() === "") {
            setKeys([])
            return
        }

        setLoading(Loading.LIST, true)
        fetchAllListApiKeys(workspaceId)
            .then((res) => {
                setKeys(res.data)
            })
            .catch(console.error)
            .finally(() => {
                setLoading(Loading.LIST, false)
            })
    }, [canViewApiKeys, setLoading, workspaceId])

    const confirmDeleteKey = useCallback(async () => {
        if (!canEditApiKeys || !pendingDeletePrefix) return

        const prefix = pendingDeletePrefix
        setPendingDeletePrefix(null)
        setLoading(Loading.DELETE, true)
        await deleteApiKey(prefix)
            .then(() => {
                setKeys((keys) => keys.filter((key) => key.prefix !== prefix))
            })
            .catch(console.error)
            .finally(() => {
                setLoading(Loading.DELETE, false)
            })
    }, [canEditApiKeys, pendingDeletePrefix, setLoading])

    const createKey = useCallback(() => {
        if (!canEditApiKeys) return

        setLoading(Loading.CREATE, true)
        if (!workspaceId || workspaceId.trim() === "") {
            setLoading(Loading.CREATE, false)
            setIsModalVisible(true)
        } else {
            createApiKey(workspaceId)
                .then(({data}) => {
                    listKeys()
                    setCreatedKey(data)
                })
                .catch(console.error)
                .finally(() => {
                    setLoading(Loading.CREATE, false)
                })
        }
    }, [canEditApiKeys, listKeys, setLoading, workspaceId])

    useEffect(() => {
        if (!canViewApiKeys) {
            setKeys([])
            return
        }

        listKeys()
    }, [canViewApiKeys, listKeys])

    const columns = useMemo<ColumnDef<APIKey, unknown>[]>(() => {
        const baseColumns: ColumnDef<APIKey, unknown>[] = [
            {
                id: "prefix",
                accessorKey: "prefix",
                header: "API Key",
                size: 400,
                enableSorting: false,
                cell: ({row}) => (
                    <span className={monospaceKeyClass}>{row.original.prefix.padEnd(40, "*")}</span>
                ),
            },
            {
                id: "created_at",
                accessorKey: "created_at",
                header: "Created",
                enableSorting: false,
                cell: ({row}) => new Date(row.original.created_at).toLocaleDateString(),
            },
            {
                id: "expiration_date",
                accessorKey: "expiration_date",
                header: "Expires",
                enableSorting: false,
                cell: ({row}) => {
                    const value = row.original.expiration_date
                    const date = value ? new Date(value) : null
                    const hasExpired = date ? date < new Date() : false
                    return (
                        <span className={hasExpired ? "text-destructive" : undefined}>
                            {hasExpired ? "Expired" : date ? date.toLocaleDateString() : "Never"}
                        </span>
                    )
                },
            },
            {
                id: "last_used_at",
                accessorKey: "last_used_at",
                header: "Last Used",
                enableSorting: false,
                cell: ({row}) => {
                    const value = row.original.last_used_at
                    return value ? new Date(value).toLocaleString() : "Never Used"
                },
            },
        ]

        if (!canEditApiKeys) {
            return baseColumns
        }

        return [
            ...baseColumns,
            {
                id: "action",
                header: () => <GearSix size={16} className="mx-auto" />,
                size: 96,
                enableSorting: false,
                cell: ({row}) => (
                    <div className="flex items-center justify-center gap-1">
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Delete API key"
                                        onClick={() => setPendingDeletePrefix(row.original.prefix)}
                                    >
                                        <Trash className="text-destructive" />
                                    </Button>
                                }
                            />
                            <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                    </div>
                ),
            },
        ]
    }, [canEditApiKeys])

    if (!canViewApiKeys) {
        return (
            <Alert>
                <WarningCircle />
                <AlertTitle>You do not have access to API Keys in this project.</AlertTitle>
            </Alert>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            {canEditApiKeys ? (
                <div className="flex items-center gap-2">
                    <Button size="sm" disabled={loading[Loading.CREATE]} onClick={createKey}>
                        {loading[Loading.CREATE] ? <Spinner /> : <Plus size={14} />}
                        Generate
                    </Button>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Reload API keys"
                                    disabled={loading[Loading.LIST]}
                                    onClick={listKeys}
                                >
                                    {loading[Loading.LIST] ? (
                                        <Spinner />
                                    ) : (
                                        <ArrowClockwise size={14} />
                                    )}
                                </Button>
                            }
                        />
                        <TooltipContent>Reload API keys</TooltipContent>
                    </Tooltip>
                </div>
            ) : null}
            <DataTable<APIKey>
                columns={columns}
                data={keys}
                getRowId={(row) => row.prefix}
                loading={loading[Loading.LIST]}
                enableSorting={false}
            />

            <Dialog open={isModalVisible} onOpenChange={setIsModalVisible}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Workspace ID Required</DialogTitle>
                        <DialogDescription>
                            Please provide a valid Workspace ID to proceed with creating an API Key.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={() => setIsModalVisible(false)}>OK</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={pendingDeletePrefix !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDeletePrefix(null)
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete API Key</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this API Key? This action is
                            irreversible!
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-white"
                            onClick={confirmDeleteKey}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog
                open={createdKey !== null}
                onOpenChange={(open) => {
                    if (!open) setCreatedKey(null)
                }}
            >
                <DialogContent className="sm:max-w-[650px]">
                    <DialogHeader>
                        <DialogTitle>API Key created</DialogTitle>
                        <DialogDescription>
                            Make sure to copy your API Key now. You won’t be able to see it again!
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-start gap-2">
                        <span
                            className={`${monospaceKeyClass} min-w-0 break-all font-semibold text-muted-foreground`}
                        >
                            {createdKey}
                        </span>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Copy API key"
                                        onClick={() => createdKey && copyToClipboard(createdKey)}
                                    >
                                        <Copy />
                                    </Button>
                                }
                            />
                            <TooltipContent>Copy</TooltipContent>
                        </Tooltip>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setCreatedKey(null)}>Done</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default APIKeys
