
import { useState, useEffect } from 'react';
import { Button, Col, Row, Switch } from 'antd';
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

    fetch('http://localhost/api/app_variant/list/', {
      headers: {
        "Content-Type": "application/json",
      }
    })
      .then((res) => res.json())
      .then((data) => {
        // setAppVariants(data)
        setAppVariants([
          { id: 1, name: 'App Variant 1', endpoint: '/1' },
          { id: 2, name: 'App Variant 2', endpoint: '/2' },
          { id: 3, name: 'App Variant 3', endpoint: '/3' }]
        );
        setAppVariantsLoading(false);
      })
  };

  useEffect(() => {
    loadAppVariants();
  }, [])


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

      <Row justify="space-between" style={{ marginTop: 20, marginBottom: 20 }}>
        <Col>
          <Button onClick={runBenchmarking} icon={<CaretRightOutlined />} style={{ marginRight: 10 }}>Run All</Button>
          <Button onClick={loadAppVariants}>Refresh App Variants</Button>
        </Col>
        <Col>
          <div>
            <span style={{ marginRight: 10, fontWeight: 10 }}>Switch to Chat mode</span>
            <Switch defaultChecked={false} onChange={onSwitchToChatMode} />
          </div>
        </Col>
      </Row>

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