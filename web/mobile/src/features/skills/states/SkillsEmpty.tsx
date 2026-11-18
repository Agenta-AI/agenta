import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {SkillCreateChooser} from "@agenta/skills-ui"
import {Compass} from "@phosphor-icons/react"

/** The project has no skills yet: the three ways in. */
export const SkillsEmpty = ({
    onWrite,
    onUpload,
    onImport,
}: {
    onWrite: () => void
    onUpload: (scan: Promise<SkillUploadScan>) => void
    onImport: () => void
}) => (
    <div className="flex animate-skill-enter flex-col items-center gap-5 rounded-[14px] border border-dashed border-input px-4 py-14 text-center">
        <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-[14px] border border-solid border-border bg-muted text-foreground"
        >
            <Compass size={22} />
        </span>
        <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-lg font-semibold leading-[26px]">Add your first skill</h2>
            <p className="m-0 max-w-[440px] text-sm text-muted-foreground">
                Write the steps once, then any agent in this project can follow them.
            </p>
        </div>
        <div className="w-full max-w-[640px] text-left">
            <SkillCreateChooser onWrite={onWrite} onUpload={onUpload} onImport={onImport} />
        </div>
    </div>
)
