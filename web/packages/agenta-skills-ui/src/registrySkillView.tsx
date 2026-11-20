import {lazy, Suspense} from "react"

import {SkillFormSkeleton} from "@agenta/entity-ui/drill-in"
import {defineView, type ViewProps} from "@agenta/ui/view-stack"

import type {RegistrySkillParams} from "./RegistrySkillViewBody"

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
    id: "skills.registrySkill",
    apply: "on_save",
    wide: true,
    Component: RegistrySkillBody,
})
