import {useState, useCallback} from "react"

import {UploadFile} from "antd"

import {message} from "@/oss/components/AppMessageContext"
import {globalErrorHandler} from "@/oss/lib/helpers/errorHandler"
import {isValidCSVFile, isValidJSONFile} from "@/oss/lib/helpers/fileManipulations"
import {GenericObject} from "@/oss/lib/Types"
import {uploadTestsetPreview} from "@/oss/services/testsets/api"

export type FileType = "JSON" | "CSV" | undefined

const getFileType = (fileName: string): FileType => {
    const extension = fileName.split(".").pop()?.toLowerCase()
    if (extension === "csv") return "CSV"
    if (extension === "json") return "JSON"
    return undefined
}

interface UseTestsetFileUploadOptions {
    onSuccess?: (response: any) => void
    onError?: (error: any) => void
    defaultTestsetName?: string
}

export const useTestsetFileUpload = (options: UseTestsetFileUploadOptions = {}) => {
    const {onSuccess, onError, defaultTestsetName = ""} = options

    const [uploadType, setUploadType] = useState<FileType>(undefined)
    const [testsetName, setTestsetName] = useState(defaultTestsetName)
    const [uploadLoading, setUploadLoading] = useState(false)
    const [fileProgress, setFileProgress] = useState<UploadFile>({} as UploadFile)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)

    const handleFileSelect = useCallback(
        (file: UploadFile) => {
            setFileProgress(file)
            const detectedType = getFileType(file.name)
            setUploadType(detectedType)
            setSelectedFile(file.originFileObj as File)

            // Auto-populate testset name from file name if not already set
            if (!testsetName) {
                setTestsetName(file.name.split(".")[0] as string)
            }
        },
        [testsetName],
    )

    const resetUpload = useCallback(() => {
        setTestsetName(defaultTestsetName)
        setUploadType(undefined)
        setFileProgress({} as UploadFile)
        setSelectedFile(null)
        setUploadLoading(false)
    }, [defaultTestsetName])

    const uploadFile = useCallback(
        async (customTestsetName?: string) => {
            const nameToUse = customTestsetName?.trim() || testsetName.trim()
            const malformedFileError = `The file you uploaded is either malformed or is not a valid ${uploadType} file`

            if (!selectedFile || !uploadType) {
                message.error("Please select a file to upload")
                return {success: false}
            }

            // Validate file format
            const isValidFile = await (uploadType === "CSV"
                ? isValidCSVFile(selectedFile)
                : isValidJSONFile(selectedFile))

            if (!isValidFile) {
                message.error(malformedFileError)
                return {success: false}
            }

            try {
                setUploadLoading(true)

                // Use the new preview API that creates testset + variant + v1 revision
                const response = await uploadTestsetPreview(
                    selectedFile,
                    uploadType.toLowerCase() as "csv" | "json",
                    nameToUse || undefined,
                )

                message.success("Testset uploaded successfully")

                // Call success callback if provided
                onSuccess?.(response)

                // Reset state after successful upload
                resetUpload()

                return {
                    success: true,
                    data: response.data,
                    revisionId: response.data?.testset?.revision_id,
                }
            } catch (e: any) {
                console.error("Upload error:", e)

                // Handle specific error cases
                if (typeof e?.response?.data?.detail === "string") {
                    message.error(e.response.data.detail)
                } else if (
                    e?.response?.data?.detail?.find((item: GenericObject) =>
                        item?.loc?.includes("csvdata"),
                    )
                ) {
                    message.error(malformedFileError)
                } else {
                    globalErrorHandler(e)
                }

                // Call error callback if provided
                onError?.(e)

                return {success: false, error: e}
            } finally {
                setUploadLoading(false)
            }
        },
        [selectedFile, uploadType, testsetName, onSuccess, onError, resetUpload],
    )

    return {
        // State
        uploadType,
        testsetName,
        uploadLoading,
        fileProgress,
        selectedFile,

        // State setters
        setTestsetName,
        setUploadType,

        // Actions
        handleFileSelect,
        uploadFile,
        resetUpload,
    }
}
