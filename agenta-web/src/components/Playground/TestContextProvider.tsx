import {GenericObject} from "@/lib/Types"
import React, {PropsWithChildren, createContext, useState} from "react"

export const TestContext = createContext<{
    testList: GenericObject[]
    setTestList: React.Dispatch<React.SetStateAction<GenericObject[]>>
    setResultsList: React.Dispatch<React.SetStateAction<string[]>>
    resultsList: string[]
}>({testList: [{}], setTestList: () => {}, resultsList: [], setResultsList: () => {}})

const TestContextProvider: React.FC<PropsWithChildren> = (props) => {
    const [testList, setTestList] = useState<GenericObject[]>([{}])
    const [resultsList, setResultsList] = useState<string[]>(testList.map(() => ""))

    return (
        <TestContext.Provider value={{testList, setTestList, resultsList, setResultsList}}>
            {props.children}
        </TestContext.Provider>
    )
}

export default TestContextProvider
