import {ArrowsOut, Copy, DownloadSimple, MinusCircle, UploadSimple} from "@phosphor-icons/react"
import {Button} from "antd"
import {PlaygroundPromptToolsOptionsProps} from "./types"
import clsx from "clsx"
import PlaygroundPromptToolMenu from "../../Menus/PlaygroundPromptToolMenu"

const PlaygroundPromptToolsOptions: React.FC<PlaygroundPromptToolsOptionsProps> = ({className}) => {
    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <Button icon={<ArrowsOut size={14} />} type="text" />
            <Button icon={<Copy size={14} />} type="text" />
            <Button icon={<DownloadSimple size={14} />} type="text" />
            <Button icon={<UploadSimple size={14} />} type="text" />
            <Button icon={<MinusCircle size={14} />} type="text" />
            <PlaygroundPromptToolMenu />
        </div>
    )
}

export default PlaygroundPromptToolsOptions
