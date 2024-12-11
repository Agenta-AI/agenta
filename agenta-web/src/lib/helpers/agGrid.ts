import dynamic from "next/dynamic"

const AgGridReact = dynamic(
    async () => {
        const ClientSideRowModelModule = await import(
            "@ag-grid-community/client-side-row-model"
        ).then((module) => module.ClientSideRowModelModule)
        const ModuleRegistry = await import("@ag-grid-community/core").then(
            (module) => module.ModuleRegistry,
        )
        ModuleRegistry.registerModules([ClientSideRowModelModule])

        const AgGridReact = import("@ag-grid-community/react").then((mod) => mod.AgGridReact)

        return AgGridReact
    },
    {
        ssr: false,
    },
)

export default AgGridReact
