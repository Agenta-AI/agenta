import EvaluationTable from '@/components/EvaluationTable/EvaluationTable';
import { AppEvaluation } from '@/lib/Types';
import { loadAppEvaluation, loadEvaluationsRows } from '@/lib/services/api';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function Evaluation() {
    const router = useRouter();
    const evaluationTableId = router.query.evaluation_id ? router.query.evaluation_id.toString() : '';
    const [evaluationRows, setEvaluationRows] = useState([]);
    const [appEvaluation, setAppEvaluation] = useState<AppEvaluation | undefined>();

    const columnsCount = 2;

    useEffect(() => {
        const init = async () => {
            const data = await loadEvaluationsRows(evaluationTableId);
            setEvaluationRows(data);
        }
        init();
    }, []);

    useEffect(() => {
        if (!evaluationTableId) {
            return;
        }
        const init = async () => {
            const appEvaluation:AppEvaluation = await loadAppEvaluation(evaluationTableId);
            setAppEvaluation(appEvaluation)
        }
        init();
    }, [evaluationTableId]);

    return (
        <div>
            {evaluationTableId && evaluationRows && appEvaluation &&
                <EvaluationTable
                    columnsCount={columnsCount}
                    evaluationRows={evaluationRows}
                    appEvaluation={appEvaluation}
                />
            }
        </div>

    );
}