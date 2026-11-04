import type {Workflow} from "@agenta/entities/workflow"
import {LoadError} from "@agenta/ui/components/presentational"

import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {EnvironmentCards} from "../variants/EnvironmentCards"
import {EnvironmentCardsSkeleton} from "../variants/states/EnvironmentCardsSkeleton"
import {useAppEnvironments} from "../variants/useAppEnvironments"

import {SectionTitle} from "./states/SectionTitle"

/**
 * Where each environment points. A card opens that environment in the deployments tab of the
 * variants view, by its slug, and is a plain block while that view is off.
 */
export const AppDeploymentSection = ({app, base}: {app: Workflow; base: string}) => {
    const {environments} = useAppEnvironments(app.id)
    const variantsEnabled = useDeveloperViewEnabled("variants") === true

    return (
        <section aria-label="Deployment">
            <SectionTitle title="Deployment" />
            {environments.isError ? (
                <LoadError
                    framed
                    title="Could not load deployments"
                    onRetry={() => void environments.refetch()}
                />
            ) : environments.isPending ? (
                <EnvironmentCardsSkeleton />
            ) : (
                <EnvironmentCards
                    environments={environments.data}
                    getHref={
                        variantsEnabled
                            ? (environment) =>
                                  `${base}/variants?app=${encodeURIComponent(app.id)}&tab=deployments&env=${encodeURIComponent(environment.slug)}`
                            : undefined
                    }
                />
            )}
        </section>
    )
}
