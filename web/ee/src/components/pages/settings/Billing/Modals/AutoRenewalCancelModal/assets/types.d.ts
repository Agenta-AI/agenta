import {ModalProps, RadioGroupProps} from "antd"

export interface AutoRenewalCancelModalProps extends ModalProps {}

export interface AutoRenewalCancelModalContentProps extends RadioGroupProps {
    inputValue: string
    onChangeInput: (e: ChangeEvent<HTMLInputElement>) => void
}
