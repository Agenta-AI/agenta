import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {useIsExpandedWindow} from "@agenta/ui/hooks"
import {RightPane, SkeletonBlock} from "@agenta/ui/ui"
import {Files} from "@phosphor-icons/react"

const FILE_ROWS = 8

/** The skill page while it loads, in the editor's shape: Description, Instructions and Files (STATE-02). */
export const SkillPageSkeleton = () => {
    const t = useT(skillsEditorCatalog)
    const expanded = useIsExpandedWindow()
    return (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <SkeletonBlock className="h-[18px] w-24" />
                <SkeletonBlock shape="soft" className="h-15" />
            </div>
            <div className="flex flex-col gap-1">
                <div className="flex h-7 items-center justify-between gap-3">
                    <SkeletonBlock className="h-[18px] w-24" />
                    <SkeletonBlock className="h-5 w-48 max-sm:w-28" />
                </div>
                <SkeletonBlock shape="soft" className="h-[60dvh]" />
            </div>
            {/* The Files pane docks with the page on a wide window, as the loaded editor's does. */}
            <RightPane
                open={expanded}
                onOpenChange={() => undefined}
                title={
                    <span className="flex items-center gap-2">
                        <Files aria-hidden size={16} />
                        {t("skills.editor.files")}
                    </span>
                }
                focusOnOpen={false}
            >
                <div className="flex flex-col gap-1 px-4 pt-2 sm:px-6">
                    {Array.from({length: FILE_ROWS}, (_, index) => (
                        <div key={index} className="flex h-row-single items-center gap-2">
                            <SkeletonBlock shape="mark" className="size-6" />
                            <SkeletonBlock className="h-3.5 w-32" />
                        </div>
                    ))}
                </div>
            </RightPane>
        </div>
    )
}
