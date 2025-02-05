import {useCallback, useRef} from "react"
import {PlaygroundUtilities, PlaygroundUtilitiesConfig} from "./types"

const usePlaygroundUtilities = ({
    config,
}: {
    config: PlaygroundUtilitiesConfig
}): PlaygroundUtilities => {
    const {debug} = config
    const valueReferences = useRef<string[]>([])

    const logger = useCallback(
        (log: string, ...args: any[]) => {
            if (!debug) return
            console.debug(
                `usePlayground[%cMiddleware%c] - ${config.name} for ${config?.hookId} : ${log}`,
                "color: red",
                "",
                ...args,
            )
        },
        [debug, config.name, config?.hookId],
    )

    const addToValueReferences = useCallback(
        (key: string) => {
            if (!valueReferences.current.includes(key)) {
                logger(`${config?.hookId} - SELECT ${key} - ${config.variantId}`)
                valueReferences.current = [...valueReferences.current, key]
            }
        },
        [logger, config?.hookId, config.variantId],
    )

    const checkInvalidSelector = useCallback(() => {
        if (!config.variantId) {
            throw new Error(
                "variantId is required when trying to select a variant related property",
            )
        }
    }, [config.variantId])

    return {
        addToValueReferences,
        logger,
        valueReferences,
        checkInvalidSelector,
    }
}

export default usePlaygroundUtilities
