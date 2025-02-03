import {memo} from "react"
import {Typography, Input} from "antd"
import {ConfirmDeploymentNoteProps} from "./types"

const {Text} = Typography

const ConfirmDeploymentNote = ({value, setValue}: ConfirmDeploymentNoteProps) => {
    return (
        <>
            <div className="flex flex-col gap-1">
                <Text>You are about to deploy staging environment</Text>
                <Text>Revision v6</Text>
            </div>

            <div className="flex flex-col gap-1">
                <Text>Notes (optional)</Text>
                <Input.TextArea
                    placeholder="Describe why you are deploying"
                    className="w-full"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                />
            </div>
        </>
    )
}

export default memo(ConfirmDeploymentNote)
