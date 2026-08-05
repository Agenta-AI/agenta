import {useCallback, useEffect, useMemo, useState} from "react"

import {
    environmentMolecule,
    fetchEnvironmentRevisionsList,
    type EnvironmentRevision,
} from "@agenta/entities/environment"
import {useUserDisplayName} from "@agenta/entities/shared/user"
import {PlaygroundConfigSection} from "@agenta/entity-ui/drill-in"
import {projectIdAtom} from "@agenta/shared/state"
import {Button, Card, Divider, Space, Typography, notification} from "antd"
import clsx from "clsx"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import {useAtomValue, useSetAtom} from "jotai"
import debounce from "lodash/debounce"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"

dayjs.extend(relativeTime)

// ============================================================================
// TYPES
// ============================================================================

interface AppReference {
    application?: {id?: string; slug?: string}
    application_variant?: {id?: string; slug?: string}
    application_revision?: {id?: string; slug?: string; version?: string}
}

interface RevisionItem {
    id: string
    version: number | null
    created_at: string | null
    message: string | null
    author: string | null
    created_by_id: string | null
    appRevisionId: string | null
    variantSlug: string | null
    appDeploymentIndex: number
    _envRevision: EnvironmentRevision
}

interface DeploymentHistoryProps {
    environmentSlug: string
    appId: string
}

// ============================================================================
// HELPERS
// ============================================================================

function getAppRevisionId(rev: EnvironmentRevision, appId: string): string | null {
    if (!rev.data?.references) return null
    const refs = rev.data.references as Record<string, AppReference>
    for (const ref of Object.values(refs)) {
        if (ref?.application?.id === appId) {
            return ref.application_revision?.id ?? null
        }
    }
    return null
}

function extractAppRef(
    data: EnvironmentRevision["data"],
    appId: string,
): {appRevisionId: string | null; variantSlug: string | null} {
    if (!data?.references) return {appRevisionId: null, variantSlug: null}
    const refs = data.references as Record<string, AppReference>
    for (const ref of Object.values(refs)) {
        if (ref?.application?.id === appId) {
            return {
                appRevisionId: ref.application_revision?.id ?? null,
                variantSlug: ref.application_variant?.slug ?? null,
            }
        }
    }
    return {appRevisionId: null, variantSlug: null}
}

// ============================================================================
// AUTHOR DISPLAY
// ============================================================================

const AuthorDisplay = ({authorId}: {authorId: string | null}) => {
    const name = useUserDisplayName(authorId ?? undefined)
    return <Typography.Text>{name ?? "-"}</Typography.Text>
}

// ============================================================================
// COMPONENT
// ============================================================================

const {Text} = Typography

const DeploymentHistory: React.FC<DeploymentHistoryProps> = ({environmentSlug, appId}) => {
    const {appTheme} = useAppTheme()
    const isDark = appTheme === "dark"
    const projectId = useAtomValue(projectIdAtom)

    const entityEnv = useAtomValue(
        useMemo(() => environmentMolecule.atoms.bySlug(environmentSlug), [environmentSlug]),
    )
    const environmentId = entityEnv?.id ?? ""
    const environmentVariantId = entityEnv?.variant_id ?? ""

    const appDeployment = useAtomValue(
        useMemo(
            () =>
                environmentMolecule.atoms.appDeploymentInEnvironment(`${environmentSlug}:${appId}`),
            [environmentSlug, appId],
        ),
    )
    const currentAppRevisionId = appDeployment?.applicationRevision?.id ?? null

    const [items, setItems] = useState<RevisionItem[]>([])
    const [activeIndex, setActiveIndex] = useState(0)
    const [isLoading, setIsLoading] = useState(false)
    const [isReverting, setIsReverting] = useState(false)

    const revert = useSetAtom(environmentMolecule.actions.revert)

    const selectedItem = items[activeIndex] ?? null
    const isCurrentDeployment = selectedItem?.appRevisionId === currentAppRevisionId

    // ========================================================================
    // FETCH REVISIONS
    // ========================================================================

    const fetchData = useCallback(async () => {
        if (!projectId || !environmentId || !appId) return

        setIsLoading(true)
        try {
            const response = await fetchEnvironmentRevisionsList({
                projectId,
                environmentId,
                applicationId: appId,
            })

            // Filter and dedup
            const withAppRef = response.environment_revisions
                .filter((r) => (r.version ?? 0) > 0)
                .filter((r) => {
                    if (!r.data?.references) return false
                    const refs = r.data.references as Record<string, AppReference>
                    return Object.values(refs).some((ref) => ref?.application?.id === appId)
                })

            const deduped: typeof withAppRef = []
            for (let i = 0; i < withAppRef.length; i++) {
                const current = getAppRevisionId(withAppRef[i], appId)
                const older =
                    i + 1 < withAppRef.length ? getAppRevisionId(withAppRef[i + 1], appId) : null
                if (current !== older) {
                    deduped.push(withAppRef[i])
                }
            }

            const total = deduped.length
            const rows: RevisionItem[] = deduped.map((r, i) => {
                const {appRevisionId, variantSlug} = extractAppRef(r.data, appId)
                return {
                    id: r.id,
                    version: r.version ?? null,
                    created_at: r.created_at ?? null,
                    message: r.message ?? null,
                    author: r.author ?? null,
                    created_by_id: r.created_by_id ?? null,
                    appRevisionId,
                    variantSlug,
                    appDeploymentIndex: total - i,
                    _envRevision: r,
                }
            })

            setItems(rows)
            if (rows.length > 0) {
                setActiveIndex(0)
            }
        } catch (error) {
            console.error("Failed to fetch deployment revisions:", error)
        } finally {
            setIsLoading(false)
        }
    }, [projectId, environmentId, appId])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // ========================================================================
    // REVERT
    // ========================================================================

    const handleRevert = useCallback(async () => {
        const item = selectedItem
        if (
            !projectId ||
            !environmentId ||
            !environmentVariantId ||
            !item ||
            item.version == null
        ) {
            return
        }

        setIsReverting(true)
        try {
            const result = await revert({
                projectId,
                environmentId,
                environmentVariantId,
                targetRevisionVersion: item.version,
                message: `Reverted to deployment v${item.appDeploymentIndex}`,
            })

            if (result?.success) {
                notification.success({
                    message: "Environment Revision",
                    description: "Environment successfully reverted",
                    duration: 3,
                })
                await fetchData()
            } else {
                notification.error({
                    message: "Revert Failed",
                    description: "Failed to revert deployment",
                    duration: 3,
                })
            }
        } catch (err) {
            console.error(err)
        } finally {
            setIsReverting(false)
        }
    }, [projectId, environmentId, environmentVariantId, selectedItem, revert, fetchData])

    // ========================================================================
    // HANDLERS
    // ========================================================================

    const handleSelectItem = useMemo(
        () =>
            debounce((index: number) => {
                setActiveIndex(index)
            }, 300),
        [],
    )

    // ========================================================================
    // RENDER
    // ========================================================================

    return (
        <>
            {isLoading ? (
                <ResultComponent status="info" title="Loading..." spinner={true} />
            ) : items.length > 0 ? (
                <div className="flex gap-5">
                    <div
                        className={clsx(
                            "flex-[0.2] overflow-y-scroll p-[10px] rounded-[10px] min-w-[300px] h-[600px]",
                            isDark
                                ? "bg-[#333]"
                                : "bg-[#FFFFFF] border border-solid border-[#f0f0f0]",
                        )}
                    >
                        {items.map((item, index) => (
                            <div
                                key={item.id}
                                style={{
                                    backgroundColor:
                                        activeIndex === index
                                            ? appTheme === "dark"
                                                ? "#4AA081"
                                                : "#F3F8F6"
                                            : appTheme === "dark"
                                              ? "#1f1f1f"
                                              : "#fff",
                                    border:
                                        activeIndex === index
                                            ? "1px solid #4aa081"
                                            : `1px solid ${
                                                  appTheme === "dark" ? "transparent" : "#f0f0f0"
                                              }`,
                                }}
                                className="flex flex-col py-[10px] px-5 my-5 rounded-[10px] cursor-pointer"
                                onClick={() => handleSelectItem(index)}
                            >
                                <Space style={{justifyContent: "space-between"}}>
                                    <Text
                                        className={clsx(
                                            "text-sm",
                                            isDark
                                                ? "[&_span]:text-[#f1f5f8]"
                                                : "[&_span]:text-[#656d76]",
                                        )}
                                    >
                                        <b>Deployment</b> <span>v{item.appDeploymentIndex}</span>
                                    </Text>
                                    <Text
                                        className={clsx(
                                            "text-sm",
                                            isDark
                                                ? "[&_span]:text-[#f1f5f8]"
                                                : "[&_span]:text-[#656d76]",
                                        )}
                                    >
                                        <span style={{fontSize: 12}}>
                                            {item.created_at
                                                ? dayjs(item.created_at).fromNow()
                                                : "-"}
                                        </span>
                                    </Text>
                                </Space>

                                {item.appRevisionId === currentAppRevisionId && (
                                    <Text
                                        style={{
                                            fontStyle: "italic",
                                            fontSize: 12,
                                            color: appTheme === "dark" ? "#fff" : "#4AA081",
                                        }}
                                    >
                                        Current deployment
                                    </Text>
                                )}

                                <Divider className="my-[10px]" />

                                <Space>
                                    <div>
                                        <Text strong>Modified By: </Text>
                                        <AuthorDisplay
                                            authorId={item.created_by_id ?? item.author}
                                        />
                                    </div>
                                </Space>
                            </div>
                        ))}
                    </div>

                    <div
                        className={clsx(
                            "flex-[0.8] p-5 rounded-[10px]",
                            isDark
                                ? "bg-[#333]"
                                : "bg-[#FFFFFF] border border-solid border-[#f0f0f0]",
                        )}
                    >
                        <div className="flex items-center justify-between [&_h1]:text-[32px]">
                            <h1>Information</h1>

                            {items.length > 1 && !isCurrentDeployment && (
                                <Button type="primary" loading={isReverting} onClick={handleRevert}>
                                    Revert
                                </Button>
                            )}
                        </div>

                        {selectedItem?.appRevisionId ? (
                            <Card title="Configuration" style={{margin: 30}}>
                                <PlaygroundConfigSection
                                    revisionId={selectedItem.appRevisionId}
                                    useServerData
                                    viewMode="json"
                                    disabled
                                />
                            </Card>
                        ) : (
                            <div className="text-colorTextDescription text-center mt-6">
                                No parameters to display
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-center mx-auto my-[30px] text-[20px] font-bold">
                    No deployment history available
                </div>
            )}
        </>
    )
}

export default DeploymentHistory
