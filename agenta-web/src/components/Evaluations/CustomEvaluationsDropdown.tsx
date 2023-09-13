import React, {useState, useEffect} from "react"
import {Select} from "antd"
import {fetchCustomEvaluations} from "@/lib/services/api"
import {SingleCustomEvaluation} from "@/lib/Types"
import {EvaluationType} from "@/lib/enums"

const {Option} = Select

interface IEvaluationDropdownProps {
    classes: any
    appName: string
    setEvalType: any
    setEvalID: any
}

const EvaluationDropdown: React.FC<IEvaluationDropdownProps> = ({
    classes,
    appName,
    setEvalType,
    setEvalID,
}) => {
    const [evaluation, setEvaluation] = useState<string>("")
    const [evaluationList, setEvaluationList] = useState<SingleCustomEvaluation[]>()

    useEffect(() => {
        fetchCustomEvaluations(appName).then((res) => {
            if (res.status === 200) {
                setEvaluationList(res.data)
            }
        })
    }, [appName])

    const handleChange = (e: string) => {
        setEvaluation(e)
    }

    const setOptionName = () => {
        if (!evaluation) {
            return "Custom Evaluations"
        } else {
            setEvalType(EvaluationType.custom_code_run)
            setEvalID(evaluation)
            return evaluation
        }
    }

    return (
        <Select className={classes.selectGroup} value={setOptionName()} onChange={handleChange}>
            {evaluationList?.map((item: SingleCustomEvaluation) => (
                <Option key={item.id} value={item.id}>
                    {item.evaluation_name}
                </Option>
            ))}
        </Select>
    )
}

export default EvaluationDropdown
