/**
 * AppMessageContext - Static exports for Ant Design message/modal/notification
 *
 * This component captures Ant Design's App context and exports static instances
 * of message, modal, and notification that can be used anywhere without hooks.
 *
 * ## Usage
 *
 * 1. Render the component inside your Ant Design App provider:
 * ```tsx
 * import { App } from 'antd'
 * import { AppMessageContext } from '@agenta/ui'
 *
 * function MyApp() {
 *   return (
 *     <App>
 *       <AppMessageContext />
 *       {children}
 *     </App>
 *   )
 * }
 * ```
 *
 * 2. Import and use the static exports anywhere:
 * ```tsx
 * import { message, modal, notification } from '@agenta/ui'
 *
 * // In any function or component
 * message.success('Saved successfully')
 * modal.confirm({ title: 'Are you sure?' })
 * notification.info({ message: 'Update available' })
 * ```
 */

import {App} from "antd"
import type {MessageInstance} from "antd/es/message/interface"
import type {ModalStaticFunctions} from "antd/es/modal/confirm"
import type {NotificationInstance} from "antd/es/notification/interface"

let message: MessageInstance
let notification: NotificationInstance
let modal: Omit<ModalStaticFunctions, "warn">

/**
 * Component that captures Ant Design's App context.
 * Must be rendered inside an Ant Design App provider.
 */
const AppMessageContext = () => {
    const staticFunction = App.useApp()
    message = staticFunction.message
    modal = staticFunction.modal
    notification = staticFunction.notification
    return null
}

export default AppMessageContext

export {message, modal, notification}
