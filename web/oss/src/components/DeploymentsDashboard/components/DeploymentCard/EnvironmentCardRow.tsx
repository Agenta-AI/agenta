import clsx from "clsx"

import type {Environment} from "@/oss/lib/Types"

import DeploymentCardSkeleton, {DEPLOYMENT_SKELETON_ENVIRONMENTS} from "./skeleton"

import DeploymentCard from "./index"

interface EnvironmentCardRowProps {
    environments?: Environment[]
    isLoading: boolean
    selectedEnvName?: string
    onCardClick?: (environment: Environment) => void
    className?: string
}

const EnvironmentCardRow = ({
    environments,
    isLoading,
    selectedEnvName,
    onCardClick,
    className,
}: EnvironmentCardRowProps) => {
    const dataset = environments ?? []

    return (
        <div className={clsx("w-full flex gap-4", className)}>
            {isLoading
                ? DEPLOYMENT_SKELETON_ENVIRONMENTS.map((envName) => (
                      <DeploymentCardSkeleton
                          key={envName}
                          envName={envName}
                          isSelected={selectedEnvName?.toLowerCase() === envName.toLowerCase()}
                      />
                  ))
                : dataset.map((env, index) => (
                      <DeploymentCard
                          key={env.id ?? env.name ?? index}
                          env={env}
                          selectedEnv={selectedEnvName}
                          onClick={() => onCardClick?.(env)}
                      />
                  ))}
        </div>
    )
}

export default EnvironmentCardRow
