import {Drawer} from "antd"
import React from "react"

type VariantDrawerProps = {} & React.ComponentProps<typeof Drawer>

const VariantDrawer = ({...props}: VariantDrawerProps) => {
    return <Drawer width={560} destroyOnClose {...props}></Drawer>
}

export default VariantDrawer
