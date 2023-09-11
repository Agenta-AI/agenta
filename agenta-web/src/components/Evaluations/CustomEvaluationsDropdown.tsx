import React, { useState, useEffect } from 'react'
import { Select } from 'antd'
import { fetchCustomEvaluations } from '@/lib/services/api';
import { SingleCustomEvaluation } from '@/lib/Types';

const { Option } = Select;



const EvaluationDropdown: React.FC = ({ classes, appName }) => {
	const [evaluation, setEvaluation] = useState<string>('');
	const [evaluationList, setEvaluationList] = useState<SingleCustomEvaluation[]>()
	
	useEffect(() => {
		fetchCustomEvaluations(appName).then(res => {
			if (res.status === 200) {
				setEvaluationList(res.data);
			}
		});
	}, [appName]); 

    const handleChange = (e: string) => {
        setEvaluation(e)
    };

	const setOptionName = () => {
		if (!evaluation){
			return "List Custom Evaluations"
		} else {
			return evaluation
		}
	}

    return (
        <Select
            className={classes.selectGroup}
            value={setOptionName()}
            onChange={handleChange}
        >
            {evaluationList?.map((item: SingleCustomEvaluation) => (
                <Option key={item.id} value={item.evaluation_name}>
                    {item.evaluation_name}
                </Option>
            ))}
        </Select>
    )
}

export default EvaluationDropdown
