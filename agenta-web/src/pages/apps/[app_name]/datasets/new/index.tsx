import { UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Space, Spin, Upload, message } from "antd";
import { useState } from "react";
import axios from 'axios';
import { useRouter } from "next/router";

export default function AddANewDataset() {
    const router = useRouter();
    const { app_name } = router.query;
    const [form] = Form.useForm();
    const [uploadLoading, setUploadLoading] = useState(false);

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
            formData.append('app_name', app_name?.toString() || '');

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

                    // setDataset(data);
                    setUploadLoading(false);
                    form.resetFields();

                    const pathSegments = router.asPath.split('/');
                    pathSegments.pop();
                    const newPath = pathSegments.join('/');
                    router.push(newPath);

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

    const layout = {
        labelCol: { span: 8 },
        wrapperCol: { span: 16 },
    };

    const tailLayout = {
        wrapperCol: { offset: 8, span: 16 },
    };

    return (
        <div>
            <Space direction="vertical" style={{ width: '70%' }}>
                <Alert
                    message="File format"
                    description={<>
                        In order to make the dataset working correctly it should be:<br />
                        - A CSV file.<br />
                        - The first row should contain the headers<br />
                        - The next rows should contain the data<br />
                    </>}
                    type="info"
                    style={{ marginBottom: 40 }}
                />
            </Space>

            <Spin spinning={uploadLoading}>
                <Form onFinish={onFinish} form={form} style={{ maxWidth: 600 }} {...layout}>
                    <Form.Item
                        name="datasetName"
                        label="Dataset name"
                        rules={[{ type: 'string' }]}
                    >
                        <Input maxLength={25} />
                    </Form.Item>
                    <Form.Item name="file" valuePropName="fileList" getValueFromEvent={(e) => e.fileList} label="Dataset source">
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

                    <Form.Item {...tailLayout}>
                        <Button type="primary" htmlType="submit">
                            Add dataset
                        </Button>
                    </Form.Item>
                </Form>
            </Spin>
        </div>
    );
}
