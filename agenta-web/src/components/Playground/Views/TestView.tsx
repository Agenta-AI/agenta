import React, { Dispatch, SetStateAction, useContext, useState } from "react";
import { Button, Input, Card, Row, Col } from "antd";
import { CaretRightOutlined, PlusOutlined } from "@ant-design/icons";
import { callVariant } from "@/lib/services/api";
import { Parameter } from "@/lib/Types";
import { renameVariables } from "@/lib/helpers/utils";
import { TestContext } from "../TestContextProvider";
import LoadTestsModal from "../LoadTestsModal";

interface TestViewProps {
  URIPath: string | null;
  inputParams: Parameter[] | null;
  optParams: Parameter[] | null;
}

interface BoxComponentProps {
  inputParams: Parameter[] | null;
  URIPath: string | null;
  testData: Record<string, string>;
  testIndex: number;
  setTestList: Dispatch<SetStateAction<Record<string, string>[]>>;
  handleRun: (testData: Record<string, string>, testIndex: number) => Promise<void>;
  results: string;
}

const BoxComponent: React.FC<BoxComponentProps> = ({
  inputParams,
  URIPath,
  testData,
  testIndex,
  setTestList,
  handleRun,
  results,
}) => {
  const { TextArea } = Input;

  if (!inputParams) {
    return <div>Loading...</div>;
  }

  const inputParamsNames = inputParams.map((param) => param.name);

  const handleInputParamValChange = (inputParamName: string, newValue: string) => {
    setTestList((prevState) => {
      const newState = prevState.map((test, index) =>
        index === testIndex ? { ...test, [inputParamName]: newValue } : test
      );
      return newState;
    });
  };

  return (
    <>
      {/* </Card> */}

      <Card
        style={{
          marginTop: 16,
          border: "1px solid #ccc",
          marginRight: "24px",
        }}
        bodyStyle={{ padding: "4px 16px", border: "0px solid #ccc" }}
      >
        <h4 style={{ padding: "0px", marginTop: "8px", marginBottom: "0px" }}>
          Input parameters
        </h4>

        <Row style={{ marginTop: "0px" }}>
          {inputParamsNames.map((key, index) => (
            <TextArea
              key={index}
              value={testData[key]}
              placeholder={renameVariables(key)}
              onChange={(e) => handleInputParamValChange(key, e.target.value)}
              style={{ height: "100%", width: "100%", marginTop: "16px" }}
            />
          ))}
        </Row>
        <Row style={{ marginTop: "16px" }}>
          <Col span={24} style={{ textAlign: "right" }}>
            <Button
              type="primary"
              shape="round"
              icon={<CaretRightOutlined />}
              onClick={() => handleRun(testData, testIndex)}
              style={{ width: "100px" }}
            >
              Run
            </Button>
          </Col>
        </Row>
        <Row style={{ marginTop: "16px", marginBottom: "16px" }}>
          <TextArea
            value={results}
            rows={6}
            placeholder="Results will be shown here"
            disabled
            style={{
              height: "100%",
              width: "100%",
            }}
          />
        </Row>
      </Card>
    </>
  );
};

const App: React.FC<TestViewProps> = ({ inputParams, optParams, URIPath }) => {
    const { testList, setTestList } = useContext(TestContext);

    const [resultsList, setResultsList] = useState<string[]>(testList.map(() => ""));
  
    const handleRun = async (testData: Record<string, string>, testIndex: number) => {
      const newResultsList = [...resultsList];
      newResultsList[testIndex] = "Loading...";
      
      try {
        const result = await callVariant(testData, optParams, URIPath);
        newResultsList[testIndex] = result;
      } catch (e) {
        newResultsList[testIndex] =
          "The code has resulted in the following error: \n\n --------------------- \n" +
          e +
          "\n---------------------\n\nPlease update your code, and re-serve it using cli and try again.\n\nFor more information please read https://docs.agenta.ai/howto/how-to-debug\n\nIf you believe this is a bug, please create a new issue here: https://github.com/Agenta-AI/agenta/issues/new?title=Issue%20in%20playground";
      }
  
      setResultsList(newResultsList);
    };

    const handleAddRow = () => {
        setTestList([...testList, {}]);
      };
    
      const handleAddNewTests: (tests: Record<string, string>[]) => void = (tests) => {
        setTestList([...testList, ...tests]);
      };
    
      const handleSetNewTests: (tests: Record<string, string>[]) => void = (tests) => {
        setTestList([...tests]);
      };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginRight: "24px",
        }}
      >
        <h2 style={{ padding: "0px", marginBottom: "8px" }}>2. Preview and test</h2>
        <LoadTestsModal setNewTests={handleSetNewTests} addNewTests={handleSetNewTests} />
      </div>

      {testList.map((testData, index) => (
        <BoxComponent
        key={index}
        inputParams={inputParams}
        URIPath={URIPath}
        testData={testData}
        testIndex={index}
        setTestList={setTestList}
        handleRun={(testData) => handleRun(testData, index)}
        results={resultsList[index]}
        />
      ))}
      <Button
        type="primary"
        size="large"
        icon={<PlusOutlined />}
        onClick={handleAddRow}
        style={{ marginTop: "16px", width: "200px", marginBottom: "24px" }}
      >
        Add Row
      </Button>
    </div>
  );
};

export default App;
