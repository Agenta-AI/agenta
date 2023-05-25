
import { UploadOutlined } from "@ant-design/icons";
import { Button, Form, Input, Spin, Upload, message } from "antd";
import { useState } from 'react';
import axios from 'axios';
import DatasetsTable from "./DatasetsTable";
import { Dataset } from "@/lib/Types";

export default function Datasets() {
    const [uploadLoading, setUploadLoading] = useState(false);
    const [dataset, setDataset] = useState<Dataset>({
        id: '1',
        name: 'Example Dataset',
    });
    const [form] = Form.useForm();

    const onFinish = async (values: any) => {
        const { file } = values;

        if (!values.file) {
            message.error('Please select a file to upload');
            return;
        }

        if (file && file.length > 0) {
            const formData = new FormData();
            formData.append('file', file[0].originFileObj);
            if (values.datasetName && values.datasetName.trim() !== "") {
                formData.append('dataset_name', values.datasetName);
            }

            try {
                setUploadLoading(true);
                const response = await axios.post('http://localhost/api/datasets/upload', formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                });

                if (response.status === 200) {
                    // File uploaded successfully
                    const data = response.data;

                    setDataset(data);
                    setUploadLoading(false);
                    form.resetFields();
                } else {
                    // Handle error
                    console.error('Failed to upload file:', response.status);
                    setUploadLoading(false); // Set loading state to false after failed upload
                }
            } catch (error) {
                console.error('Error uploading file', error);
            }
        };
    };

    return (
        <div>
            <Spin spinning={uploadLoading}>
                <Form onFinish={onFinish} form={form}>
                    <Form.Item
                        name="datasetName"
                        label="Dataset name"
                        rules={[{ type: 'string' }]}
                    >
                        <Input style={{ width: '25%' }} maxLength={25} />
                    </Form.Item>
                    <Form.Item name="file" valuePropName="fileList" getValueFromEvent={(e) => e.fileList} >
                        <Upload.Dragger
                            name="file"
                            accept=".csv"
                            multiple={false}
                            maxCount={1}
                        >
                            <p className="ant-upload-drag-icon">
                                <UploadOutlined />
                            </p>
                            <p className="ant-upload-text">Click or drag a CSV file to this area to upload</p>
                        </Upload.Dragger>
                    </Form.Item>
                    <Form.Item>
                        <Button type="primary" htmlType="submit">
                            Upload
                        </Button>
                    </Form.Item>
                </Form>
            </Spin>

            <DatasetsTable dataset={dataset} />
        </div>


    );
}
