import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {RightOutlined} from "@ant-design/icons"
import {Divider, Input, Menu, Popover, Spin, Typography} from "antd"
import {atom, useAtom, useSetAtom} from "jotai"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useRowHeight} from "@/oss/components/InfiniteVirtualTable"
import {buildRevisionMenuItems} from "@/oss/components/TestcasesTableNew/components/RevisionMenuItems"
import {TestcasesTableShell} from "@/oss/components/TestcasesTableNew/components/TestcasesTableShell"
import {useTestcasesTable} from "@/oss/components/TestcasesTableNew/hooks/useTestcasesTable"
import {
    testcaseRowHeightAtom,
    TESTCASE_ROW_HEIGHT_CONFIG,
} from "@/oss/components/TestcasesTableNew/state/rowHeight"
import {Testset} from "@/oss/lib/Types"
import {useEntityList} from "@/oss/state/entities/hooks/useEntityList"
import {
    latestRevisionForTestsetAtomFamily,
    revisionsListQueryAtomFamily,
    testsetStore,
} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import {
    selectTestsetAtom,
    selectedRevisionIdAtom,
    selectedTestsetIdAtom,
} from "@/oss/state/testsetSelection"
import {urlAtom} from "@/oss/state/url"

import {LoadTestsetModalContentProps} from "../types"

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {
        ssr: false,
    },
)

const TestcasesTablePreview = ({
    revisionId,
    selectedRowKeys,
    setSelectedRowKeys,
}: {
    revisionId: string
    selectedRowKeys: React.Key[]
    setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
}) => {
    const table = useTestcasesTable({revisionId, mode: "view"})
    const rowHeight = useRowHeight(testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG)

    const handleRowClick = useCallback(
        (record: any) => {
            const key = record?.key
            if (key === undefined || key === null) return
            setSelectedRowKeys((prev) => {
                const exists = prev.includes(key)
                if (exists) {
                    return prev.filter((k) => k !== key)
                }
                return [...prev, key]
            })
        },
        [setSelectedRowKeys],
    )

    return (
        <div className="relative min-h-0 flex flex-col overflow-hidden h-full w-full">
            <TestcasesTableShell
                mode="view"
                revisionIdParam={revisionId}
                table={table}
                rowHeight={rowHeight}
                selectedRowKeys={selectedRowKeys}
                onSelectedRowKeysChange={setSelectedRowKeys}
                onRowClick={handleRowClick}
                onDeleteSelected={() => {}}
                searchTerm={table.searchTerm}
                onSearchChange={table.setSearchTerm}
                header={null}
                actions={null}
                hideControls={false}
                enableSelection
                autoHeight
                disableDeleteAction
            />
        </div>
    )
}

const LoadTestsetModalContent = ({
    modalProps,
    testsetCsvData,
    selectedRowKeys,
    setSelectedRowKeys,
    isLoadingTestset,
}: Omit<
    LoadTestsetModalContentProps,
    | "selectedTestset"
    | "setSelectedTestset"
    | "selectedRevisionId"
    | "setSelectedRevisionId"
    | "isChat"
>) => {
    // Use shared atoms for testset/revision selection
    const [selectedTestset, setSelectedTestset] = useAtom(selectedTestsetIdAtom)
    const [selectedRevisionId, setSelectedRevisionId] = useAtom(selectedRevisionIdAtom)
    const selectTestset = useSetAtom(selectTestsetAtom)
    const projectId = useAtomValue(projectIdAtom)
    const listParams = useMemo(() => ({projectId: projectId ?? ""}), [projectId])
    const {data: testsetListResponse, isLoading: isLoadingTestsets} = useEntityList(
        testsetStore,
        listParams,
    )
    const testsets = useMemo(() => testsetListResponse?.testsets ?? [], [testsetListResponse])
    const router = useRouter()

    const [searchTerm, setSearchTerm] = useState("")
    const urlState = useAtomValue(urlAtom)
    const [revisionPanelTestsetId, setRevisionPanelTestsetId] = useState("")

    const emptyQueryAtom = useMemo(
        () =>
            atom({
                data: [] as {
                    id: string
                    version: number
                    created_at?: string | null
                    message?: string | null
                }[],
                isFetching: false,
                isPending: false,
                isLoading: false,
            }),
        [],
    )
    const selectedRevisionsQueryAtom = useMemo(
        () => (selectedTestset ? revisionsListQueryAtomFamily(selectedTestset) : emptyQueryAtom),
        [selectedTestset, emptyQueryAtom],
    )
    const popoverRevisionsQueryAtom = useMemo(
        () =>
            revisionPanelTestsetId
                ? revisionsListQueryAtomFamily(revisionPanelTestsetId)
                : selectedRevisionsQueryAtom,
        [revisionPanelTestsetId, selectedRevisionsQueryAtom],
    )
    const selectedRevisionsQuery = useAtomValue(selectedRevisionsQueryAtom)
    const popoverRevisionsQuery = useAtomValue(popoverRevisionsQueryAtom)

    const revisions = useMemo(
        () =>
            (selectedRevisionsQuery.data as {
                id: string
                version: number
                created_at?: string | null
                message?: string | null
            }[]) || [],
        [selectedRevisionsQuery.data],
    )

    const popoverRevisions = useMemo(
        () =>
            (popoverRevisionsQuery.data as {
                id: string
                version: number
                created_at?: string | null
                message?: string | null
            }[]) || [],
        [popoverRevisionsQuery.data],
    )

    const filteredRevisions = revisions
    const filteredPopoverRevisions = popoverRevisions
    const popoverRevisionsLoading =
        popoverRevisionsQuery.isPending ||
        (popoverRevisionsQuery as any).isLoading ||
        (popoverRevisionsQuery as any).isFetching

    const latestRevisionAtom = useMemo(
        () => latestRevisionForTestsetAtomFamily(selectedTestset),
        [selectedTestset],
    )
    const latestRevision = useAtomValue(latestRevisionAtom)

    const handleCreateTestset = useCallback(() => {
        router.push(`${urlState.projectURL}/testsets`)
    }, [router, urlState?.projectURL])

    // Auto-select first testset when modal opens (uses shared selectTestsetAtom which also selects latest revision)
    useEffect(() => {
        if (!modalProps.open || !testsets.length) return

        const prevExists =
            selectedTestset && testsets.some((ts: Testset) => ts?.id === selectedTestset)
        if (!prevExists && testsets[0]) {
            selectTestset({
                testsetId: testsets[0].id,
                testsetName: testsets[0].name,
                autoSelectLatest: true,
            })
        }
    }, [modalProps.open, testsets, selectedTestset, selectTestset])

    // Auto-select latest revision when revisions load and none is selected
    useEffect(() => {
        if (!selectedTestset || selectedRevisionId) return
        const latestId =
            filteredRevisions.find((rev) => rev.id === latestRevision?.id)?.id ||
            filteredRevisions[0]?.id
        if (latestId) {
            setSelectedRevisionId(latestId)
        }
    }, [
        filteredRevisions,
        latestRevision?.id,
        selectedRevisionId,
        selectedTestset,
        setSelectedRevisionId,
    ])

    const filteredTestset = useMemo(() => {
        if (!searchTerm) return testsets
        return testsets.filter((item: Testset) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, testsets])

    const testsetMenuItems = useMemo(() => {
        if (!filteredTestset.length) return []
        return filteredTestset.map((ts: Testset) => ({
            key: ts.id,
            label: ts.name,
            hasRevisions:
                ts.latest_revision_version === undefined ? true : ts.latest_revision_version > 0,
        }))
    }, [filteredTestset])

    const onChangeTestset = useCallback(
        ({key}: any) => {
            setSelectedRowKeys([])
            const testset = testsets.find((ts: Testset) => ts.id === key)
            selectTestset({
                testsetId: key,
                testsetName: testset?.name || "",
                autoSelectLatest: true,
            })
        },
        [setSelectedRowKeys, testsets, selectTestset],
    )

    const onChangeRevision = useCallback(
        ({key}: any) => {
            setSelectedRowKeys([])
            setSelectedRevisionId(key)
            setRevisionPanelTestsetId("")
        },
        [setRevisionPanelTestsetId, setSelectedRevisionId, setSelectedRowKeys],
    )

    const popoverMenuItems = useMemo(
        () =>
            buildRevisionMenuItems(filteredPopoverRevisions, (revisionId) => {
                setSelectedTestset(revisionPanelTestsetId || selectedTestset || "")
                onChangeRevision({key: revisionId})
                setRevisionPanelTestsetId("")
            }) ?? [],
        [filteredPopoverRevisions, onChangeRevision, revisionPanelTestsetId, selectedTestset],
    )

    const menuSelectedKeys = useMemo(
        () => (selectedTestset ? [selectedTestset] : []),
        [selectedTestset],
    )
    const revisionSelectedKeys = useMemo(
        () => (selectedRevisionId ? [selectedRevisionId] : []),
        [selectedRevisionId],
    )

    if (!projectId) {
        return (
            <div className="flex items-center justify-center py-6">
                <Spin />
            </div>
        )
    }

    if (!testsets.length && !testsetCsvData.length && !isLoadingTestset && !isLoadingTestsets)
        return (
            <NoResultsFound
                primaryActionLabel="Create new testset"
                onPrimaryAction={handleCreateTestset}
            />
        )

    return (
        <div className="w-full flex flex-col h-full min-h-0 overflow-hidden">
            <section className="flex grow gap-4 min-h-0 overflow-hidden ">
                <div className="flex flex-col gap-4 w-[280px]">
                    <Input.Search
                        placeholder="Search testsets"
                        allowClear
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />

                    <Divider className="m-0" />

                    <div className="flex items-center justify-between">
                        <Typography.Text className="font-medium">Testsets</Typography.Text>
                    </div>

                    <Menu
                        selectable={false}
                        items={testsetMenuItems.map((ts) => {
                            // Destructure hasRevisions to prevent it from being passed to DOM
                            const {hasRevisions: _hasRevisions, ...restTs} = ts as any
                            const hasRevisions = _hasRevisions ?? true
                            return {
                                ...restTs,
                                label: (
                                    <div className="flex items-center gap-2 pl-1 pr-1 w-full">
                                        <span
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                onChangeTestset({key: ts.key})
                                                setRevisionPanelTestsetId(ts.key as string)
                                            }}
                                            className="cursor-pointer flex-1 min-w-0 truncate text-left"
                                            title={ts.label as string}
                                        >
                                            {ts.label}
                                        </span>
                                        {hasRevisions && (
                                            <Popover
                                                placement="right"
                                                trigger={["click"]}
                                                open={revisionPanelTestsetId === ts.key}
                                                onOpenChange={(open) => {
                                                    if (open) {
                                                        setRevisionPanelTestsetId(ts.key as string)
                                                    } else if (revisionPanelTestsetId === ts.key) {
                                                        setRevisionPanelTestsetId("")
                                                    }
                                                }}
                                                content={
                                                    popoverRevisionsLoading ? (
                                                        <div className="flex items-center justify-center px-3 py-2">
                                                            <Spin size="small" />
                                                        </div>
                                                    ) : popoverMenuItems.length ? (
                                                        <div className="max-h-80 overflow-y-auto">
                                                            <Menu
                                                                items={popoverMenuItems}
                                                                onSelect={(info) => {
                                                                    setSelectedTestset(
                                                                        ts.key as string,
                                                                    )
                                                                    onChangeRevision(info)
                                                                    setRevisionPanelTestsetId("")
                                                                }}
                                                                selectedKeys={revisionSelectedKeys}
                                                                className="min-w-[220px] !border-none !p-0 !m-0 [&_.ant-menu-item]:h-auto [&_.ant-menu-item]:min-h-[32px] [&_.ant-menu-item]:leading-normal [&_.ant-menu-item]:!py-1 [&_.ant-menu-item]:!px-3 [&_.ant-menu-item]:!my-0 [&_.ant-menu-title-content]:whitespace-normal"
                                                                rootClassName="!p-0 !m-0"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="px-3 py-2 text-xs text-gray-500">
                                                            No revisions
                                                        </div>
                                                    )
                                                }
                                                overlayClassName="load-testset-revision-popover"
                                                styles={{body: {padding: 0}}}
                                            >
                                                <span
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-label="Show revisions"
                                                    className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded transition-all duration-150 cursor-pointer ${
                                                        revisionPanelTestsetId === ts.key
                                                            ? "text-blue-600"
                                                            : "text-gray-400 hover:text-gray-600"
                                                    }`}
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setRevisionPanelTestsetId(ts.key as string)
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault()
                                                            e.stopPropagation()
                                                            setRevisionPanelTestsetId(
                                                                ts.key as string,
                                                            )
                                                        }
                                                    }}
                                                    onMouseDown={(e) => {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                    }}
                                                >
                                                    <RightOutlined className="text-xs" />
                                                </span>
                                            </Popover>
                                        )}
                                    </div>
                                ),
                            }
                        })}
                        selectedKeys={menuSelectedKeys}
                        className="h-[400px] overflow-y-auto !border-none !p-0 [&_.ant-menu-item]:px-2 [&_.ant-menu-item]:py-1.5 [&_.ant-menu-item]:h-auto [&_.ant-menu-item]:min-h-[38px] [&_.ant-menu-title-content]:flex [&_.ant-menu-title-content]:items-center [&_.ant-menu-title-content]:w-full"
                    />
                    {isLoadingTestsets && (
                        <div className="flex items-center justify-center py-2">
                            <Spin size="small" />
                        </div>
                    )}
                </div>

                <Divider orientation="vertical" className="m-0 h-full" />

                <div className="w-full h-full flex flex-col gap-4 grow min-h-0 overflow-hidden">
                    {selectedRevisionId ? (
                        <TestcasesTablePreview
                            revisionId={selectedRevisionId}
                            selectedRowKeys={selectedRowKeys}
                            setSelectedRowKeys={setSelectedRowKeys}
                        />
                    ) : (
                        <div className="flex items-start">
                            <Typography.Text className="text-lg font-medium -mt-1">
                                Select a revision to view testcases.
                            </Typography.Text>
                        </div>
                    )}
                </div>
            </section>
        </div>
    )
}

export default memo(LoadTestsetModalContent)
