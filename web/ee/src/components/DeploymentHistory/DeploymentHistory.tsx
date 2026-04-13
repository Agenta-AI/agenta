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
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import {useAtomValue, useSetAtom} from "jotai"
import debounce from "lodash/debounce"
import {createUseStyles} from "react-jss"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"
import type {JSSTheme} from "@/oss/lib/Types"

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
// STYLES
// ============================================================================

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        gap: 20,
    },
    historyItemsContainer: {
        flex: 0.2,
        backgroundColor: theme.isDark ? "#333" : "#FFFFFF",
        border: theme.isDark ? "" : "1px solid #f0f0f0",
        overflowY: "scroll",
        padding: 10,
        borderRadius: 10,
        minWidth: 300,
        height: "600px",
    },
    historyItems: {
        display: "flex",
        flexDirection: "column",
        padding: "10px 20px",
        margin: "20px 0",
        borderRadius: 10,
        cursor: "pointer",
    },
    promptHistoryInfo: {
        flex: 0.8,
        backgroundColor: theme.isDark ? "#333" : "#FFFFFF",
        border: theme.isDark ? "" : "1px solid #f0f0f0",
        padding: 20,
        borderRadius: 10,
    },
    promptHistoryInfoHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1": {
            fontSize: 32,
        },
    },
    emptyContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "30px auto",
        fontSize: 20,
        fontWeight: "bold",
    },
    divider: {
        margin: "10px 0",
    },
    historyItemsTitle: {
        fontSize: 14,
        "& span": {
            color: theme.isDark ? "#f1f5f8" : "#656d76",
        },
    },
    noParams: {
        color: theme.colorTextDescription,
        textAlign: "center",
        marginTop: theme.marginLG,
    },
    loadingContainer: {
        display: "grid",
        placeItems: "center",
        height: "100%",
    },
}))

// ============================================================================
// COMPONENT
// ============================================================================

const DeploymentHistory: React.FC<DeploymentHistoryProps> = ({environmentSlug, appId}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
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
                <div className={classes.container}>
                    <div className={classes.historyItemsContainer}>
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
                                className={classes.historyItems}
                                onClick={() => handleSelectItem(index)}
                            >
                                <Space style={{justifyContent: "space-between"}}>
                                    <Text className={classes.historyItemsTitle}>
                                        <b>Deployment</b> <span>v{item.appDeploymentIndex}</span>
                                    </Text>
                                    <Text className={classes.historyItemsTitle}>
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

                                <Divider className={classes.divider} />

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

                    <div className={classes.promptHistoryInfo}>
                        <div className={classes.promptHistoryInfoHeader}>
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
                            <div className={classes.noParams}>No parameters to display</div>
                        )}
                    </div>
                </div>
            ) : (
                <div className={classes.emptyContainer}>No deployment history available</div>
            )}
        </>
    )
}

export default DeploymentHistory
