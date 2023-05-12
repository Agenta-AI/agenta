
import { useState } from 'react';
import { Button } from 'antd';
import EvaluationTable from '../EvaluationTable/EvaluationTable';
import { CaretRightOutlined } from '@ant-design/icons';


export default function Evaluations() {
  const [isLoading, setLoading] = useState(false);
  const [areAppVersionsLoading, setAppVersionsLoading] = useState(false);
  const [appVersions, setAppVersions] = useState<any[]>([]);
  const [columnsCount, setColumnsCount] = useState(2);

  const [evaluationValues, setEvaluationValues] = useState({});

  const loadAppVersions = () => {
    setAppVersionsLoading(true);
    // setColumnsCount(3);

    // fetch('http://127.0.0.1:3030/api/app-versions', {
    //   headers: {
    //     "Content-Type": "application/json",
    //   }
    // })
    //   .then((res) => res.json())
    //   .then((data) => {
    //     setAppVersions(data)
    //     setAppVersionsLoading(false);
    //   })

    setAppVersions([
      { id: 1, name: 'App Version 1', endpoint: '/1' },
      { id: 2, name: 'App Version 2', endpoint: '/2'},
      { id: 3, name: 'App Version 3', endpoint: '/3' }]
    )
  };


  const runBenchmarking = () => {
    console.log(evaluationValues);
  };

  if (isLoading) return <div>Loading...</div>

  return (
    <div>
      <h1 className="text-2xl font-semibold pb-10">Evaluations</h1>
      <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <Button onClick={loadAppVersions} className={appVersions.length == 0 ? 'button-animation' : ''}>Load App Versions</Button>
        <Button type="primary" onClick={runBenchmarking} icon={<CaretRightOutlined />} style={{marginLeft: 10}}>Run</Button>
      </div>

      <EvaluationTable
        columnsCount={columnsCount}
        appVersions={appVersions}
        onReady={setEvaluationValues}
      />
    </div>
  );

}