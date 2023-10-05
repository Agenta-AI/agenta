import React, {
    Dispatch,
    PropsWithChildren,
    SetStateAction,
    createContext,
    useState,
    useEffect,
} from "react"

export const TestContext = createContext<{
    testList: Record<string, string>[]
    setTestList: Dispatch<SetStateAction<Record<string, string>[]>>
}>({testList: [{}], setTestList: () => {}})

const TestsetContextProvider: React.FC<PropsWithChildren> = (props) => {
    const [testList, setTestList] = useState<Record<string, string>[]>(() => {
        const savedTestList = localStorage.getItem("testList")
        return savedTestList ? JSON.parse(savedTestList) : [{}]
    })

    useEffect(() => {
        localStorage.setItem("testList", JSON.stringify(testList))
    }, [testList])

    return (
        <TestContext.Provider value={{testList, setTestList}}>
            {props.children}
        </TestContext.Provider>
    )
}

export default TestsetContextProvider
