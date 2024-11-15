import React, {useState} from "react"
import {Table} from "antd"
import {Resizable} from "react-resizable"
import "react-resizable/css/styles.css"
import {ResizableTitle, ResizableRow} from "@/components/ServerTable/components"

const SynchronizedResizableTables = () => {
    // Shared state for synchronized column widths by index
    const [columnWidths, setColumnWidths] = useState(
        Array(8).fill(100), // Initial width for 8 columns
    )

    // Handle resizing and update shared widths
    const handleResize =
        (index) =>
        (e, {size}) => {
            setColumnWidths((prevWidths) => {
                const newWidths = [...prevWidths]
                newWidths[index] = size.width
                return newWidths
            })
        }

    // Define columns for Table 1 with the first column spanning 4 columns
    const columnsTable1 = [
        {
            title: "Details",
            dataIndex: "details",
            width: columnWidths[0],
            onHeaderCell: () => ({
                width: columnWidths[0] * 4, // Make it span across 4 columns
                onResize: handleResize(0),
            }),
            colSpan: 4, // Set to span 4 columns
            render: (value) => ({
                children: value,
                props: {colSpan: 4},
            }),
        },
        {
            title: "Name",
            dataIndex: "name",
            width: columnWidths[4],
            onHeaderCell: () => ({width: columnWidths[4], onResize: handleResize(4)}),
        },
        {
            title: "Age",
            dataIndex: "age",
            width: columnWidths[5],
            onHeaderCell: () => ({width: columnWidths[5], onResize: handleResize(5)}),
        },
        {
            title: "Location",
            dataIndex: "location",
            width: columnWidths[6],
            onHeaderCell: () => ({width: columnWidths[6], onResize: handleResize(6)}),
        },
        {
            title: "Occupation",
            dataIndex: "occupation",
            width: columnWidths[7],
            onHeaderCell: () => ({width: columnWidths[7], onResize: handleResize(7)}),
        },
    ]

    // Define columns for Table 2 with individual column headers
    const columnsTable2 = [
        {
            title: "ID",
            dataIndex: "id",
            width: columnWidths[0],
            onHeaderCell: () => ({width: columnWidths[0], onResize: handleResize(0)}),
        },
        {
            title: "Username",
            dataIndex: "username",
            width: columnWidths[1],
            onHeaderCell: () => ({width: columnWidths[1], onResize: handleResize(1)}),
        },
        {
            title: "Email",
            dataIndex: "email",
            width: columnWidths[2],
            onHeaderCell: () => ({width: columnWidths[2], onResize: handleResize(2)}),
        },
        {
            title: "Phone",
            dataIndex: "phone",
            width: columnWidths[3],
            onHeaderCell: () => ({width: columnWidths[3], onResize: handleResize(3)}),
        },
        {
            title: "Address",
            dataIndex: "address",
            width: columnWidths[4],
            onHeaderCell: () => ({width: columnWidths[4], onResize: handleResize(4)}),
        },
        {
            title: "Company",
            dataIndex: "company",
            width: columnWidths[5],
            onHeaderCell: () => ({width: columnWidths[5], onResize: handleResize(5)}),
            
        },
        {
            title: "Role",
            dataIndex: "role",
            width: columnWidths[6],
            onHeaderCell: () => ({width: columnWidths[6], onResize: handleResize(6)}),
        },
        {
            title: "Status",
            dataIndex: "status",
            width: columnWidths[7],
            onHeaderCell: () => ({width: columnWidths[7], onResize: handleResize(7)}),
        },
    ]

    // Sample data for both tables
    const dataSource1 = [
        {
            key: 1,
            details: "Personal Information",
            name: "John",
            age: 25,
            location: "New York",
            occupation: "Engineer",
        },
        {
            key: 2,
            details: "Personal Information",
            name: "Jane",
            age: 28,
            location: "San Francisco",
            occupation: "Designer",
        },
    ]

    const dataSource2 = [
        {
            key: 1,
            id: "001",
            username: "jdoe",
            email: "jdoe@example.com",
            phone: "123-456-7890",
            address: "123 Main St",
            company: "TechCorp",
            role: "Admin",
            status: "Active",
        },
        {
            key: 2,
            id: "002",
            username: "jsmith",
            email: "jsmith@example.com",
            phone: "987-654-3210",
            address: "456 Elm St",
            company: "BizGroup",
            role: "User",
            status: "Inactive",
        },
    ]

    return (
        <div>
            <h3>Table 1</h3>
            <Table
                bordered
                components={{
                    header: {
                        cell: ResizableTitle,
                    },
                }}
                columns={columnsTable1}
                dataSource={dataSource1}
                pagination={false}
            />
            <h3>Table 2</h3>
            <Table
                bordered
                components={{
                    header: {
                        cell: ResizableTitle,
                    },
                }}
                columns={columnsTable2}
                dataSource={dataSource2}
                pagination={false}
            />
        </div>
    )
}

export default SynchronizedResizableTables
