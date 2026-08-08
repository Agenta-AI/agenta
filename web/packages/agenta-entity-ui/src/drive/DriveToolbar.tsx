/**
 * DriveToolbar — the drawer's shared filters row (header row 2): the show/hide-tree toggle, the
 * search box, the origin segmented control, and the hidden / git-ignored visibility toggles. Pure
 * presentation over {@link useDriveFilters} + {@link useDriveTreePane} state.
 */
import {type FileOrigin} from "@agenta/entities/drive"
import {EnhancedButton as Button} from "@agenta/ui/components/presentational"
import {InputAffix as Input, Segmented, SimpleTooltip as Tooltip} from "@agenta/ui/ui"
import {Eye, EyeClosed, FileDashed, MagnifyingGlass, SidebarSimple} from "@phosphor-icons/react"

import {ORIGIN_TIP} from "./OriginTag"

export function DriveToolbar({
    search,
    setSearch,
    searchActive,
    showTree,
    treeVisible,
    toggleTree,
    showOrigin,
    originFilter,
    setOriginFilter,
    showHidden,
    setShowHidden,
    inGitScope,
    showGitignored,
    setShowGitignored,
}: {
    search: string
    setSearch: (value: string) => void
    searchActive: boolean
    showTree: boolean
    treeVisible: boolean
    toggleTree: () => void
    showOrigin: boolean
    originFilter: "all" | FileOrigin
    setOriginFilter: (value: "all" | FileOrigin) => void
    showHidden: boolean
    setShowHidden: (update: (v: boolean) => boolean) => void
    /** A `.gitignore` governs this folder or an ancestor — only then is the git-ignored toggle shown. */
    inGitScope: boolean
    showGitignored: boolean
    setShowGitignored: (update: (v: boolean) => boolean) => void
}) {
    return (
        /* Shared toolbar — the show/hide tree toggle sits FIRST (left), directly above the
            tree pane it controls; then search + filters. Search forces the tree of matches
            (see body), so the toggle is disabled while searching. */
        <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2">
            <Tooltip
                title={
                    searchActive
                        ? "Tree shown while searching"
                        : showTree
                          ? "Hide file tree"
                          : "Show file tree"
                }
            >
                <Button
                    type="text"
                    aria-label="Show file tree"
                    aria-pressed={treeVisible}
                    disabled={searchActive}
                    icon={
                        <SidebarSimple
                            size={16}
                            weight={treeVisible ? "fill" : "regular"}
                            className="block"
                        />
                    }
                    onClick={toggleTree}
                    className={treeVisible ? "!text-colorPrimary" : "!text-colorTextTertiary"}
                />
            </Tooltip>
            <Input
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files"
                className="w-[220px] max-w-[45%]"
                prefix={<MagnifyingGlass size={12} className="text-colorTextQuaternary" />}
            />
            {showOrigin ? (
                <Segmented
                    value={originFilter}
                    onChange={(v) => setOriginFilter(v as "all" | FileOrigin)}
                    options={[
                        {value: "all", label: "All"},
                        {
                            value: "agent",
                            label: (
                                <Tooltip title={ORIGIN_TIP.agent}>
                                    <span>Agent</span>
                                </Tooltip>
                            ),
                        },
                        {
                            value: "session",
                            label: (
                                <Tooltip title={ORIGIN_TIP.session}>
                                    <span>Session</span>
                                </Tooltip>
                            ),
                        },
                    ]}
                />
            ) : null}
            <Tooltip title={showHidden ? "Hide hidden files" : "Show hidden files"}>
                <Button
                    type="text"
                    aria-label="Show hidden files"
                    aria-pressed={showHidden}
                    icon={
                        showHidden ? (
                            <Eye size={16} className="block" />
                        ) : (
                            <EyeClosed size={16} className="block" />
                        )
                    }
                    onClick={() => setShowHidden((v) => !v)}
                    className={showHidden ? "!text-colorTextTertiary" : "!text-colorPrimary"}
                />
            </Tooltip>
            {/* Git-ignored files hidden by default; the toggle appears only inside a repo. */}
            {inGitScope ? (
                <Tooltip
                    title={showGitignored ? "Hide git-ignored files" : "Show git-ignored files"}
                >
                    <Button
                        type="text"
                        aria-label="Show git-ignored files"
                        aria-pressed={showGitignored}
                        icon={<FileDashed size={16} className="block" />}
                        onClick={() => setShowGitignored((v) => !v)}
                        className={
                            showGitignored ? "!text-colorPrimary" : "!text-colorTextTertiary"
                        }
                    />
                </Tooltip>
            ) : null}
        </div>
    )
}
