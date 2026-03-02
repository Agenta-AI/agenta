import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {RightOutlined} from "@ant-design/icons"
import {Divider, Input, Menu, Popover, Spin, Typography} from "antd"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"

import {buildRevisionMenuItems} from "@/oss/components/TestcasesTableNew/components/RevisionMenuItems"
import {Testset} from "@/oss/lib/Types"
import {revision, testset} from "@/oss/state/entities/testset"
import {
    selectTestsetAtom,
    selectedRevisionIdAtom,
    selectedTestsetIdAtom,
} from "@/oss/state/testsetSelection"

import {selectedTestcaseRowKeysAtom} from "../atoms/modalState"

type RevisionData = {
    id: string
    version: number
    created_at?: string | null
    message?: string | null
}[]

interface QueryState {
    data: RevisionData
    isFetching: boolean
    isPending: boolean
    isLoading: boolean
}

interface TestsetListSidebarProps {
    modalOpen: boolean
    isCreatingNew: boolean
}

export const TestsetListSidebar: React.FC<TestsetListSidebarProps> = ({
    modalOpen,
    isCreatingNew,
}) => {
    const [selectedTestsetId, setSelectedTestset] = useAtom(selectedTestsetIdAtom)
    const [selectedRevisionId, setSelectedRevisionId] = useAtom(selectedRevisionIdAtom)
    const selectTestsetAction = useSetAtom(selectTestsetAtom)
    const setSelectedRowKeys = useSetAtom(selectedTestcaseRowKeysAtom)
    const enableRevisionsListQuery = useSetAtom(revision.queries.enableList)

    const [searchTerm, setSearchTerm] = useState("")
    const [revisionPanelTestsetId, setRevisionPanelTestsetId] = useState("")

    // Track if we've already auto-selected for the current modal session
    const hasAutoSelectedRef = useRef(false)

    // Use testset controller API
    const testsetsQuery = useAtomValue(testset.queries.list(null))
    const testsets = useMemo(() => testsetsQuery.data?.testsets ?? [], [testsetsQuery.data])
    const isLoadingTestsets = testsetsQuery.isLoading

    // Create an actual atom for empty query state
    const emptyQueryAtom = useMemo(
        () =>
            atom<QueryState>({
                data: [],
                isFetching: false,
                isPending: false,
                isLoading: false,
            }),
        [],
    )

    const popoverRevisionsQueryAtom = useMemo(
        () =>
            revisionPanelTestsetId
                ? revision.queries.list(revisionPanelTestsetId)
                : selectedTestsetId
                  ? revision.queries.list(selectedTestsetId)
                  : emptyQueryAtom,
        [revisionPanelTestsetId, selectedTestsetId, emptyQueryAtom],
    )

    const popoverRevisionsQuery = useAtomValue(popoverRevisionsQueryAtom)

    const popoverRevisions = useMemo(
        () => (popoverRevisionsQuery.data as RevisionData) || [],
        [popoverRevisionsQuery.data],
    )

    const popoverRevisionsLoading =
        popoverRevisionsQuery.isPending ||
        (popoverRevisionsQuery as any).isLoading ||
        (popoverRevisionsQuery as any).isFetching

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
            hasRevisions: true, // Always show revision arrow for testsets
        }))
    }, [filteredTestset])

    const onChangeTestset = useCallback(
        ({key}: any) => {
            setSelectedRowKeys([])
            const foundTestset = testsets.find((ts: Testset) => ts.id === key)
            // Enable revisions query for this testset
            enableRevisionsListQuery(key)
            selectTestsetAction({
                testsetId: key,
                testsetName: foundTestset?.name || "",
                autoSelectLatest: true,
            })
        },
        [setSelectedRowKeys, testsets, selectTestsetAction, enableRevisionsListQuery],
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
            buildRevisionMenuItems(popoverRevisions, (revisionId) => {
                setSelectedTestset(revisionPanelTestsetId || selectedTestsetId || "")
                onChangeRevision({key: revisionId})
                setRevisionPanelTestsetId("")
            }) ?? [],
        [popoverRevisions, onChangeRevision, revisionPanelTestsetId, selectedTestsetId],
    )

    const menuSelectedKeys = useMemo(
        () => (selectedTestsetId ? [selectedTestsetId] : []),
        [selectedTestsetId],
    )
    const revisionSelectedKeys = useMemo(
        () => (selectedRevisionId ? [selectedRevisionId] : []),
        [selectedRevisionId],
    )

    // Reset auto-selection flag when modal closes
    useEffect(() => {
        if (!modalOpen) {
            hasAutoSelectedRef.current = false
        }
    }, [modalOpen])

    // Auto-select first testset when modal opens (but only once per modal open)
    useEffect(() => {
        if (!modalOpen || !testsets.length || isCreatingNew || hasAutoSelectedRef.current) {
            return
        }

        const prevExists =
            selectedTestsetId && testsets.some((ts: Testset) => ts?.id === selectedTestsetId)

        if (!prevExists && testsets[0]) {
            hasAutoSelectedRef.current = true
            // Enable revisions query for auto-selected testset
            enableRevisionsListQuery(testsets[0].id)
            selectTestsetAction({
                testsetId: testsets[0].id,
                testsetName: testsets[0].name,
                autoSelectLatest: true,
            })
        }
    }, [modalOpen, testsets.length, isCreatingNew])

    if (isCreatingNew && selectedRevisionId) {
        return null // Hide sidebar content during create flow - CreateTestsetCard handles UI
    }

    return (
        <>
            <Input.Search
                placeholder="Search testsets"
                allowClear
                onChange={(e) => setSearchTerm(e.target.value)}
            />

            <Divider className="m-0" />

            <div className="flex items-center justify-between">
                <Typography.Text className="font-medium">Test sets</Typography.Text>
            </div>

            <Menu
                selectable={false}
                items={testsetMenuItems.map(
                    (ts: {key: string; label: string; hasRevisions: boolean}) => {
                        const {hasRevisions: _hasRevisions, ...restTs} = ts
                        const hasRevisions = _hasRevisions ?? true
                        return {
                            ...restTs,
                            label: (
                                <div className="flex items-center gap-2 pl-1 pr-1 w-full min-w-0">
                                    <span
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            onChangeTestset({key: ts.key})
                                        }}
                                        className="cursor-pointer flex-1 min-w-0 truncate text-left"
                                        title={ts.label}
                                    >
                                        {ts.label}
                                    </span>
                                    {hasRevisions && (
                                        <Popover
                                            placement="right"
                                            trigger={["hover"]}
                                            onOpenChange={(open) => {
                                                if (open) {
                                                    setRevisionPanelTestsetId(ts.key)
                                                    // Enable lazy query for this testset
                                                    enableRevisionsListQuery(ts.key)
                                                } else {
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
                                                                setSelectedTestset(ts.key)
                                                                onChangeRevision(info)
                                                                setRevisionPanelTestsetId("")
                                                            }}
                                                            classNames={{
                                                                root: "!m-0 !p-0",
                                                            }}
                                                            selectedKeys={revisionSelectedKeys}
                                                            className="min-w-[220px] !border-none !p-0 !m-0 [&_.ant-menu-item]:h-auto [&_.ant-menu-item]:min-h-[32px] [&_.ant-menu-item]:leading-normal [&_.ant-menu-item]:!py-1 [&_.ant-menu-item]:!my-0 [&_.ant-menu-title-content]:whitespace-normal"
                                                            rootClassName="!p-0 !m-0"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="px-3 py-2 text-xs text-gray-500">
                                                        No revisions
                                                    </div>
                                                )
                                            }
                                            classNames={{
                                                root: "!p-0",
                                                content: "!p-0",
                                                container: "load-testset-revision-popover !p-1",
                                            }}
                                            getPopupContainer={() =>
                                                (document.querySelector(
                                                    ".ant-modal-body",
                                                ) as HTMLElement) || document.body
                                            }
                                        >
                                            <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-gray-400">
                                                <RightOutlined className="text-xs" />
                                            </span>
                                        </Popover>
                                    )}
                                </div>
                            ),
                        }
                    },
                )}
                selectedKeys={menuSelectedKeys}
                className="flex-1 overflow-y-auto !border-none !p-0 [&_.ant-menu-item]:px-2 [&_.ant-menu-item]:py-1.5 [&_.ant-menu-item]:h-auto [&_.ant-menu-item]:min-h-[38px] [&_.ant-menu-title-content]:flex [&_.ant-menu-title-content]:items-center [&_.ant-menu-title-content]:w-full"
            />
            {isLoadingTestsets && (
                <div className="flex items-center justify-center py-2">
                    <Spin size="small" />
                </div>
            )}
        </>
    )
}
