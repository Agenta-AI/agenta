import { Variant } from "@/lib/Types";
import { fetchVariants } from "@/lib/services/api";
import { Card, Spin, Table } from "antd";
import { ColumnsType } from "antd/es/table";
import { log } from "console";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

interface DataType {
    variantName: string;
}

export default function Endpoints() {

    const router = useRouter();
    const appName = router.query.app_name?.toString() || "";

    const [variants, setVariants] = useState<Variant[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isError, setIsError] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const backendVariants = await fetchVariants(appName);

                if (backendVariants.length > 0) {
                    setVariants(backendVariants);
                    console.log(variants);
                }

                setIsLoading(false);
            } catch (error) {
                setIsError(true);
                setIsLoading(false);
            }
        };

        fetchData();
    }, [appName]);

    const columns: ColumnsType<Variant> = [
        {
            title: 'Variant Name',
            dataIndex: 'variantName',
            key: 'variantName',
            render: (text) => <div style={{ color: "#003a8c", fontSize: '20px' }}>{text}</div>,
        },
    ];

    if (isError) return <div>failed to load variants</div>
    if (isLoading) return <div>loading variants...</div>

    const onRowClick = (record: any, rowIndex: number | undefined) => {
        router.push(`/apps/${appName}/endpoints/${record.variantName}/`);
    }

    return (
        <div style={{ margin: "50px 0px" }}>
            {isLoading ? (
                <Spin />
            ) : (
                <Table
                    onRow={(record, rowIndex) => {
                        return {
                            onClick: (event) => { onRowClick(record, rowIndex) },
                        };
                    }}
                    columns={columns}
                    dataSource={variants}
                    loading={isLoading}
                />
            )}
        </div>
    );
}