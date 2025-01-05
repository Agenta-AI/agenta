import {Button, Tag, Typography} from "antd"
import {PlusCircle, Timer, X} from "@phosphor-icons/react"
import Version from "../../../../assets/Version"
import {useStyles} from "./styles"
import clsx from "clsx"

const {Text} = Typography

const PlaygroundCompasisionNavigationCard = () => {
    const classes = useStyles()
    const time_end = "0.0453s"
    const cost = "79 / $0.0053"
    return (
        <div className={clsx("w-full flex flex-col gap-3", classes.card)}>
            <div className="flex items-center justify-between">
                <Text>Variant A</Text>
                <Button icon={<X size={14} />} type="text" />
            </div>
            <div className="flex items-center justify-between">
                <Text>Name</Text>
                <div className="flex items-center gap-1">
                    <Text>variant-name</Text>
                    <Version revision={2} />
                </div>
            </div>
            <div className="flex items-center justify-between">
                <Text>Avarage Latency</Text>
                <Tag color="default" bordered={false} className="flex items-center gap-1">
                    <Timer size={14} /> {time_end}
                </Tag>
            </div>
            <div className="flex items-center justify-between">
                <Text>Avarage Cost</Text>
                <Tag color="default" bordered={false} className="flex items-center gap-1">
                    <PlusCircle size={14} /> {cost}
                </Tag>
            </div>
        </div>
    )
}

export default PlaygroundCompasisionNavigationCard
