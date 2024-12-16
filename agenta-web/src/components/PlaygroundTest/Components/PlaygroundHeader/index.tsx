import {memo} from "react"
import {Typography} from "antd"
import AddButton from "./../../assets/AddButton"
import usePlaygroundVariants from "../../hooks/usePlaygroundVariants"

const PlaygroundHeader = () => {
    console.log("render PlaygroundHeader")
    const {addVariant} = usePlaygroundVariants({
        neverFetch: true,
        hookId: "root",
    })

    return (
        <div className="flex items-center gap-4 px-2.5 py-2">
            <Typography className="text-[16px] leading-[18px] font-[600]">Playground</Typography>
            <AddButton label={"Variant"} onClick={addVariant} />
        </div>
    )
}

export default memo(PlaygroundHeader)