import {useMemo} from "react"
import {type StateVariant} from "../../state/types"
import {PromptConfigType} from "../../state/types"

const useAgentaConfig = ({variant}: {variant: StateVariant}) => {
    const prompts: PromptConfigType[] = useMemo(() => {
        return variant.schema?.promptConfig || []
    }, [variant])

    return {
        prompts,
    }
}

export default useAgentaConfig
