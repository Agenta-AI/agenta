import {lazy, Suspense} from "react"

import {SkillFormSkeleton} from "@agenta/entity-ui/drill-in"
import type {RegistrySkillParams} from "@agenta/ui/drill-in"
import {defineView, type ViewProps} from "@agenta/ui/view-stack"

const Body = lazy(() => import("./RegistrySkillViewBody"))

/** The registry skill body, loaded on first open. The skills bridge hands it to the agent's skill view. */
export const RegistrySkillBody = (props: ViewProps<RegistrySkillParams>) => (
    <Suspense
        fallback={
            <div className="flex min-h-0 flex-1 flex-col p-4">
                <SkillFormSkeleton />
            </div>
        }
    >
        <Body {...props} />
    </Suspense>
)

/** A registry skill as its own view, for the Skills page (target `project`). */
export const registrySkillView = defineView<RegistrySkillParams>({
    id: "skill.registry",
    apply: "on_save",
    wide: true,
    Component: RegistrySkillBody,
})
