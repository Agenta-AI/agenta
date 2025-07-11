// @ts-nocheck
import {CaretRightOutlined} from "@ant-design/icons"
import {Button, Form} from "antd"

import ParamsForm from "@/oss/components/ParamsForm"
import {useLegacyVariants} from "@/oss/lib/hooks/useLegacyVariant"
import type {Evaluation} from "@/oss/lib/Types"

import {useSingleModelEvaluationTableStyles} from "../assets/styles"
import type {SingleModelEvaluationRow} from "../types"

/**
 *
 * @param evaluation - Evaluation object
 * @param evaluationScenarios - Evaluation rows
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @returns
 */
const ParamsFormWithRun = ({
    evaluation,
    record,
    rowIndex,
    onRun,
    onParamChange,
    variantData = [],
    isLoading,
}: {
    record: SingleModelEvaluationRow
    rowIndex: number
    evaluation: Evaluation
    onRun: () => void
    onParamChange: (name: string, value: any) => void
    variantData: ReturnType<typeof useLegacyVariants>
    isLoading: boolean
}) => {
    const classes = useSingleModelEvaluationTableStyles()
    const [form] = Form.useForm()
    const inputParams = variantData[0]?.inputParams

    return isLoading ? null : (
        <div>
            <div className="max-w-[300px] overflow-y-auto max-h-[300px]">
                {evaluation.testset.testsetChatColumn ? (
                    evaluation.testset.csvdata[rowIndex][evaluation.testset.testsetChatColumn] ||
                    " - "
                ) : inputParams ? (
                    <ParamsForm
                        isChatVariant={false}
                        onParamChange={onParamChange}
                        inputParams={
                            inputParams.map((item) => ({
                                ...item,
                                value: record.inputs.find((ip) => ip.input_name === item.name)
                                    ?.input_value,
                            })) || []
                        }
                        onFinish={onRun}
                        form={form}
                    />
                ) : null}
            </div>
            <div className={classes.inputTestBtn}>
                <Button
                    onClick={evaluation.testset.testsetChatColumn ? onRun : form.submit}
                    icon={<CaretRightOutlined />}
                >
                    Run
                </Button>
            </div>
        </div>
    )
}

export default ParamsFormWithRun
