import type {LegacyRef} from "react"
import dynamic from "next/dynamic"
import {type AgGridReact as AgGridReactType, AgGridReactProps} from "@ag-grid-community/react"

type ComponentType = <TData = any>(
    props: AgGridReactProps<TData> & {
        gridRef?: LegacyRef<AgGridReactType<TData>> | ((ref: AgGridReactType<TData>) => void)
    },
) => JSX.Element

const AgGridReact = dynamic(
    async (): Promise<ComponentType> => {
        const ClientSideRowModelModule = await import(
            "@ag-grid-community/client-side-row-model"
        ).then((module) => module.ClientSideRowModelModule)
        const CsvExportModule = await import("@ag-grid-community/csv-export").then(
            (module) => module.CsvExportModule,
        )
        const ModuleRegistry = await import("@ag-grid-community/core").then(
            (module) => module.ModuleRegistry,
        )
        ModuleRegistry.registerModules([ClientSideRowModelModule])
        ModuleRegistry.registerModules([CsvExportModule])

        const AgGridReact = await import("@ag-grid-community/react").then((mod) => mod.AgGridReact)

        const GridWrapper = <TData,>(
            props: AgGridReactProps<TData> & {gridRef?: LegacyRef<AgGridReactType<TData>>},
        ) => {
            return <AgGridReact ref={props.gridRef as any} {...props} />
        }

        return GridWrapper as ComponentType
    },
    {
        ssr: false,
    },
)

export type {AgGridReactType}

export default AgGridReact as unknown as ComponentType
