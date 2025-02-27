import {useState, useEffect} from "react"

const useDrawerWidth = () => {
    const [drawerWidth, setDrawerWidth] = useState<string>("100vw")

    // Set the drawer width to be the full width of the screen minus the sider width
    useEffect(() => {
        const siderElement = document.querySelector(".ant-layout-sider")
        if (siderElement) {
            const siderWidth = siderElement.clientWidth
            setDrawerWidth(`calc(100vw - ${siderWidth}px)`)
        }
    }, [])

    return {drawerWidth}
}

export default useDrawerWidth
