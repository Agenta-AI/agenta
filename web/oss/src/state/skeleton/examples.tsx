/**
 * Skeleton Data System Usage Examples
 *
 * Demonstrates how to use the skeleton data system in React components
 * for better loading states and incremental updates
 */

import React from "react"

import {Skeleton, Table, Select, Card, Progress} from "antd"
import {useAtomValue} from "jotai"

// Import skeleton-enhanced atoms
import {
    appTableSkeletonSelectorAtom,
    appSelectorSkeletonStateAtom,
    appStatsSkeletonSelectorAtom,
    progressiveLoadingAtom,
    smartRefreshAtom,
} from "../newApps/selectors/skeleton-apps"

/**
 * Example: Enhanced App Table with Skeleton Support
 *
 * This table renders immediately with skeleton data, then progressively
 * enhances as real data loads
 */
export const SkeletonAppTable: React.FC = () => {
    const tableState = useAtomValue(appTableSkeletonSelectorAtom)

    const columns = [
        {
            title: "App Name",
            dataIndex: "app_name",
            key: "app_name",
            render: (text: string, record: any) => {
                // Show skeleton for skeleton data
                if (record._skeleton?.isLoading) {
                    return <Skeleton.Input style={{width: 120}} active size="small" />
                }
                return text
            },
        },
        {
            title: "Type",
            dataIndex: "app_type",
            key: "app_type",
            render: (text: string, record: any) => {
                if (record._skeleton?.isLoading) {
                    return <Skeleton.Input style={{width: 60}} active size="small" />
                }
                return <span className="type-tag">{text}</span>
            },
        },
        {
            title: "Updated",
            dataIndex: "updated_at",
            key: "updated_at",
            render: (text: string, record: any) => {
                if (record._skeleton?.isLoading) {
                    return <Skeleton.Input style={{width: 100}} active size="small" />
                }
                return new Date(text).toLocaleDateString()
            },
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: any) => {
                if (record._skeleton?.isLoading) {
                    return <Skeleton.Button style={{width: 80}} active size="small" />
                }
                return (
                    <div>
                        <button>Edit</button>
                        <button>Delete</button>
                    </div>
                )
            },
        },
    ]

    return (
        <div>
            {/* Progressive loading indicator */}
            {tableState.isSkeleton && (
                <Progress
                    percent={tableState.progress}
                    size="small"
                    status={tableState.loadingStage === "partial" ? "active" : "normal"}
                />
            )}

            <Table
                columns={columns}
                dataSource={tableState.data}
                loading={tableState.loading && !tableState.isSkeleton} // Only show spinner for non-skeleton loading
                pagination={false}
                rowKey="key"
                className={tableState.isSkeleton ? "skeleton-table" : ""}
            />

            {tableState.isEmpty && <div className="empty-state">No apps found</div>}
        </div>
    )
}

/**
 * Example: Enhanced App Selector with Skeleton Support
 */
export const SkeletonAppSelector: React.FC = () => {
    const selectorState = useAtomValue(appSelectorSkeletonStateAtom)

    return (
        <Select
            value={selectorState.selectedId}
            placeholder={selectorState.isSkeleton ? "Loading apps..." : "Select an app"}
            style={{width: 200}}
            loading={selectorState.loading && !selectorState.isSkeleton}
            disabled={selectorState.isSkeleton && selectorState.loadingStage === "initial"}
        >
            {selectorState.options.map((option) => (
                <Select.Option
                    key={option.value}
                    value={option.value}
                    disabled={option._skeleton?.isLoading}
                >
                    {option._skeleton?.isLoading ? (
                        <Skeleton.Input style={{width: 150}} active size="small" />
                    ) : (
                        option.label
                    )}
                </Select.Option>
            ))}
        </Select>
    )
}

/**
 * Example: Enhanced App Stats with Skeleton Support
 */
export const SkeletonAppStats: React.FC = () => {
    const stats = useAtomValue(appStatsSkeletonSelectorAtom)

    return (
        <div className="app-stats">
            <Card title="App Statistics">
                <div className="stat-item">
                    <span>Total Apps:</span>
                    {stats.isSkeleton ? (
                        <Skeleton.Input style={{width: 40}} active size="small" />
                    ) : (
                        <span>{stats.total}</span>
                    )}
                </div>

                <div className="stat-item">
                    <span>By Type:</span>
                    {stats.isSkeleton ? (
                        <div>
                            <Skeleton.Input style={{width: 80}} active size="small" />
                            <Skeleton.Input style={{width: 60}} active size="small" />
                        </div>
                    ) : (
                        <div>
                            {Object.entries(stats.byType).map(([type, count]) => (
                                <span key={type}>
                                    {type}: {count}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <div className="recent-apps">
                    <h4>Recently Updated:</h4>
                    {stats.recentlyUpdated.map((app: any, index: number) => (
                        <div key={app.app_id || index} className="recent-app">
                            {app._skeleton?.isLoading ? (
                                <Skeleton.Input style={{width: 120}} active size="small" />
                            ) : (
                                <span>{app.app_name}</span>
                            )}
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    )
}

/**
 * Example: Progressive Loading Dashboard
 *
 * Shows overall loading progress and component-level states
 */
export const ProgressiveLoadingDashboard: React.FC = () => {
    const progressState = useAtomValue(progressiveLoadingAtom)
    const refreshState = useAtomValue(smartRefreshAtom)

    return (
        <div className="loading-dashboard">
            <Card title="Loading Progress" size="small">
                <Progress
                    percent={progressState.overall.progress}
                    status={progressState.overall.isComplete ? "success" : "active"}
                    format={(percent) => `${percent}% (${progressState.overall.stage})`}
                />

                <div className="component-progress">
                    {Object.entries(progressState.components).map(([name, component]) => (
                        <div key={name} className="component-item">
                            <span>{name}:</span>
                            <Progress
                                percent={component.progress}
                                size="small"
                                status={component.loaded ? "success" : "active"}
                            />
                        </div>
                    ))}
                </div>

                {refreshState.shouldShowRefreshButton && (
                    <button disabled={!refreshState.canRefresh} className="refresh-button">
                        {refreshState.refreshInProgress ? "Refreshing..." : "Refresh"}
                    </button>
                )}
            </Card>
        </div>
    )
}

/**
 * Example: Complete App Management Page with Skeleton Support
 */
export const SkeletonAppManagementPage: React.FC = () => {
    return (
        <div className="app-management-page">
            <div className="page-header">
                <h1>App Management</h1>
                <SkeletonAppSelector />
            </div>

            <div className="page-content">
                <div className="main-content">
                    <SkeletonAppTable />
                </div>

                <div className="sidebar">
                    <SkeletonAppStats />
                    <ProgressiveLoadingDashboard />
                </div>
            </div>
        </div>
    )
}

/**
 * CSS Classes for Skeleton Styling
 */
export const skeletonStyles = `
.skeleton-table {
    opacity: 0.8;
}

.skeleton-table .ant-table-row {
    animation: skeleton-pulse 1.5s ease-in-out infinite;
}

@keyframes skeleton-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

.loading-dashboard .component-item {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
}

.loading-dashboard .component-item span {
    width: 80px;
    margin-right: 12px;
}

.app-stats .stat-item {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
}

.recent-app {
    padding: 4px 0;
    border-bottom: 1px solid #f0f0f0;
}
`
