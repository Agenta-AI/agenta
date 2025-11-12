import {useCallback, useEffect, useState} from "react"

import {message} from "antd"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {createNewTestset} from "@/oss/services/testsets/api"

import {SaveDataModalProps} from "./assets/types"

const SaveDataModalContent = dynamic(() => import("./assets/SaveDataModalContent"), {ssr: false})

const SaveDataModal = ({rows, exportDataset = false, name, ...props}: SaveDataModalProps) => {
    const [submitLoading, setSubmitLoading] = useState(false)
    const [_name, setName] = useState(name || "")
    const [selectedColumns, setSelectedColumns] = useState<string[]>([])

    const getKeys = useCallback(() => {
        const keys = new Set<string>()
        rows.forEach((row) => {
            Object.keys(row).forEach((key) => keys.add(key))
        })
        return Array.from(keys)
    }, [rows])

    useEffect(() => {
        setName(name || "")
        setSelectedColumns(getKeys())
    }, [rows, name])

    const reset = useCallback(() => {
        setName("")
        setSelectedColumns([])
        setSubmitLoading(false)
    }, [])

    const onClose = useCallback(() => {
        reset()
        props.onCancel?.({} as any)
    }, [props])

    const onSaveTestset = useCallback(async () => {
        try {
            setSubmitLoading(true)

            const filteredRows = rows.map((row) => {
                const filteredRow: any = {}
                Object.keys(row).forEach((key) => {
                    if (selectedColumns.includes(key)) {
                        filteredRow[key] = row[key]
                    }
                })
                return filteredRow
            })

            await createNewTestset(_name, filteredRows)

            message.success("Testset created successfully!")
            onClose()
        } catch (error) {
            console.error("Error creating testset:", error)
            message.error("Failed to create testset. Please try again!")
        } finally {
            setSubmitLoading(false)
        }
    }, [rows, _name, selectedColumns, onClose])

    const onExportResults = useCallback(async () => {
        try {
            setSubmitLoading(true)
            const filteredRows = rows.map((row) => {
                const filteredRow: any = {}
                Object.keys(row).forEach((key) => {
                    if (selectedColumns.includes(key)) {
                        filteredRow[key] = row[key]
                    }
                })
                return filteredRow
            })

            const csvData = convertToCsv(filteredRows, selectedColumns)
            downloadCsv(csvData, _name)
            message.success("Results exported successfully!")
            onClose()
        } catch (error) {
            console.error("Error exporting results:", error)
            message.error("Error exporting results")
        } finally {
            setSubmitLoading(false)
        }
    }, [rows, selectedColumns, onClose, _name])

    return (
        <EnhancedModal
            title={exportDataset ? "Export Results" : "Add new testset"}
            okText={exportDataset ? "Export" : "Create"}
            onOk={exportDataset ? onExportResults : onSaveTestset}
            confirmLoading={submitLoading}
            okButtonProps={{disabled: !_name || !selectedColumns.length}}
            onCancel={onClose}
            afterClose={reset}
            {...props}
        >
            <SaveDataModalContent
                rows={rows}
                rowKeys={getKeys()}
                name={_name}
                setName={setName}
                isOpen={props.open as boolean}
                selectedColumns={selectedColumns}
                setSelectedColumns={setSelectedColumns}
                exportDataset={exportDataset}
            />
        </EnhancedModal>
    )
}

export default SaveDataModal
