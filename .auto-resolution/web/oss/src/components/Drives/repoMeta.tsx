/**
 * DriveRepoMetaList — the git-repo counterpart to {@link fileMeta}'s file block, and it behaves the
 * same way: a bare `<dl>` metadata grid revealed by a header toggle (not an always-on card). The
 * caller owns the toggle (the FolderView header, mirroring the file preview's "File details" button)
 * and probes with {@link useRepoInfo}; this renders the branch/commit/remote grid when the folder is
 * a git repo AND the toggle is on, animating open/closed like the file grid.
 */
import {AnimatePresence, motion} from "motion/react"

import {type RepoInfo} from "./driveRepo"
import {MetaRow} from "./fileMeta"

export function DriveRepoMetaList({info, expanded}: {info: RepoInfo; expanded?: boolean}) {
    if (!info.isRepo) return null

    // Same grid + MetaRow styling as the file metadata block, so the two read as one system.
    const grid = (
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-4 gap-y-1.5 text-[11px]">
            <MetaRow
                label="Branch"
                value={info.branch ?? (info.detached ? "detached HEAD" : undefined)}
            />
            <MetaRow label="Commit" value={info.shortSha ?? undefined} />
            <MetaRow
                label="Remote"
                value={
                    info.remote ? (
                        info.remote.href ? (
                            // Browsable host → a link (new tab, no referrer/opener). The tooltip keeps
                            // the full sanitized URL so the destination is visible before clicking.
                            <a
                                href={info.remote.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={info.remote.url}
                                className="text-[var(--ag-colorInfo)] hover:underline"
                            >
                                {info.remote.label}
                            </a>
                        ) : (
                            // Local path / non-web remote — plain text.
                            <span title={info.remote.url}>{info.remote.label}</span>
                        )
                    ) : undefined
                }
            />
        </dl>
    )

    // Reveal/collapse with the same height+fade transition the file grid uses.
    return (
        <AnimatePresence initial={false}>
            {expanded ? (
                <motion.div
                    key="repo-grid"
                    initial={{height: 0, opacity: 0}}
                    animate={{height: "auto", opacity: 1}}
                    exit={{height: 0, opacity: 0}}
                    transition={{duration: 0.2, ease: [0.4, 0, 0.2, 1]}}
                    className="overflow-hidden"
                >
                    {grid}
                </motion.div>
            ) : null}
        </AnimatePresence>
    )
}
