import {defineView} from "@agenta/ui/view-stack"

import {MarkdownEditorSkeleton} from "../../DrawerSkeletons"

import {lazyView} from "./lazyView"

export interface InstructionsViewParams {
    /** The instruction file. One today: AGENTS.md (`instructions.agents_md`). */
    file: "AGENTS.md"
}

/** The AGENTS.md editor, edge to edge, with Cancel and Save (F01 f3). */
export const instructionsView = defineView<InstructionsViewParams>({
    id: "agent.instructions",
    apply: "on_save",
    wide: true,
    readOnlyOnPhone: true,
    Component: lazyView(
        () => import("./InstructionsViewBody"),
        <div className="p-4">
            <MarkdownEditorSkeleton />
        </div>,
    ),
})
