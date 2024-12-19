import {useMemo} from "react"
import usePlaygroundVariants from "../usePlaygroundVariants"

const useAgentaConfig = ({variantId, promptIndex}: {variantId: string; promptIndex?: number}) => {
    const {variants} = usePlaygroundVariants({
        neverFetch: true,
    })

    const returnData = useMemo(() => {
        const variant = variants?.find((v) => v.variantId === variantId)
        console.log("variant", variant)
        const prompts = variant?.schema?.promptConfig || []

        const prompt = !isNaN(promptIndex as number) ? prompts[promptIndex as number] : undefined

        return {
            prompts,
            variant,
            prompt,
        }
    }, [variants, variantId, promptIndex])

    return returnData
}

export default useAgentaConfig
