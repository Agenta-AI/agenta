
import { useState } from 'react';
import { Button, Switch } from 'antd';
import EvaluationTable from '../EvaluationTable/EvaluationTable';
import EvaluationTableWithChat from '../EvaluationTable/EvaluationTableWithChat';
import { CaretRightOutlined } from '@ant-design/icons';


export default function Evaluations() {
  const [isLoading, setLoading] = useState(false);
  const [areAppVariantsLoading, setAppVariantsLoading] = useState(false);
  const [appVariants, setAppVariants] = useState<any[]>([]);
  const [columnsCount, setColumnsCount] = useState(2);

  const [evaluationValues, setEvaluationValues] = useState({});

  const [chatModeActivated, setChatModeActivated] = useState(false);

  const loadAppVariants = () => {
    setAppVariantsLoading(true);
    // setColumnsCount(3);

    // fetch('http://127.0.0.1:3030/api/app-variants', {
    //   headers: {
    //     "Content-Type": "application/json",
    //   }
    // })
    //   .then((res) => res.json())
    //   .then((data) => {
    //     setAppVariants(data)
    //     setAppVariantsLoading(false);
    //   })

    setAppVariants([
      { id: 1, name: 'App Variant 1', endpoint: '/1' },
      { id: 2, name: 'App Variant 2', endpoint: '/2' },
      { id: 3, name: 'App Variant 3', endpoint: '/3' }]
    )
  };


  const runBenchmarking = () => {
    console.log(evaluationValues);
  };

  const onSwitchToChatMode = (checked: boolean) => {
    setChatModeActivated(checked);
  };

  if (isLoading) return <div>Loading...</div>

  return (
    <div>
      <h1 className="text-2xl font-semibold pb-10">Evaluations</h1>
      <div>
        <span style={{ marginRight: 10 }}>Switch to chat mode</span>
        <Switch defaultChecked={false} onChange={onSwitchToChatMode} />
      </div>

      <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <Button onClick={loadAppVariants} className={appVariants.length == 0 ? 'button-animation' : ''}>Load App Variants</Button>
        <Button type="primary" onClick={runBenchmarking} icon={<CaretRightOutlined />} style={{ marginLeft: 10 }}>Run</Button>
      </div>

      {!chatModeActivated &&
        <EvaluationTable
          columnsCount={columnsCount}
          appVariants={appVariants}
          onReady={setEvaluationValues}
        />}

      {chatModeActivated &&
        <EvaluationTableWithChat
          columnsCount={columnsCount}
          appVariants={appVariants}
          onReady={setEvaluationValues}
        />}

    </div>
  );

}