import {memo, useCallback} from "react"
import {useRouter} from "next/router"
import {AVAILABLE_SERVICES} from "./assets/constants"
import {Typography} from "antd"
import AddButton from "./assets/AddButton"
import usePlaygroundVariants from "./hooks/usePlaygroundVariants"
import dynamic from "next/dynamic"

const PlaygroundVariant = dynamic(() => import("./Components/PlaygroundVariant"), {ssr: false})

const VariantsWrapper = memo(({service}: {service: string}) => {
    const {variants} = usePlaygroundVariants()

    console.log("render VariantsWrapper", variants)

    return (
        <div className="flex flex-col gap-2 w-full grow overflow-hidden">
            {variants.map((variant) => {
                return <PlaygroundVariant variant={variant} key={variant.variantId} />
            })}
        </div>
    )
})

const Playground: React.FC = () => {
    const router = useRouter()
    const service = router.query.service as string
    const {addVariant} = usePlaygroundVariants({
        fetcher: undefined,
        // no re-renders if data state is mutated
        compare: useCallback(() => true, []),
        hookId: "root",
    })

    console.log("render Playground")

    if (!service || !AVAILABLE_SERVICES.includes(service)) {
        return (
            <div>
                <h1>Service not found</h1>
                <p>available services are:</p>
                <ul>
                    <li>completion-old-sdk</li>
                    <li>chat-old-sdk</li>
                </ul>
            </div>
        )
    }

    return (
        <div className="flex flex-col w-full h-[calc(100dvh-70px)] overflow-hidden">
            <div className="flex items-center gap-4 px-2.5 py-2">
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Playground
                </Typography>
                <AddButton label={"Variant"} onClick={addVariant} />
            </div>
            <VariantsWrapper service={service} />
        </div>
    )
}

export default memo(Playground)
