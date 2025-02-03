import {Button, Typography, Upload} from "antd"
import {Image, Trash} from "@phosphor-icons/react"
import {PromptImageUploadProps} from "./types"

const PromptImageUpload = ({...props}: PromptImageUploadProps) => {
    return (
        <Upload
            action="https://660d2bd96ddfa2943b33731c.mockapi.io/api/upload"
            listType="picture"
            defaultFileList={[]}
            {...props}
        >
            <div className="w-full flex items-center justify-between p-2 rounded-md border border-dashed border-[#758391]">
                <div className="flex items-center gap-4">
                    <Image size={32} className="text-[#758391]" />
                    <Typography>Click or drag file to this area</Typography>
                </div>

                <Button icon={<Trash size={22} />} type="text" />
            </div>
        </Upload>
    )
}

export default PromptImageUpload
