import {AuthErrorMsgType} from "@/oss/lib/Types"

export interface EmailPasswordAuthProps {
    message: AuthErrorMsgType
    setMessage: React.Dispatch<React.SetStateAction<AuthErrorMsgType>>
    authErrorMsg: (error: any) => void
}

export interface SendOTPProps {
    message: AuthErrorMsgType
    isLoading: boolean
    email: string
    isResendDisabled: boolean
    setMessage: React.Dispatch<React.SetStateAction<AuthErrorMsgType>>
    authErrorMsg: (error: any) => void
    setIsLoginCodeVisible: React.Dispatch<React.SetStateAction<boolean>>
    setIsResendDisabled: React.Dispatch<React.SetStateAction<boolean>>
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
}

export interface PasswordlessAuthProps {
    message: AuthErrorMsgType
    isLoading: boolean
    email: string
    setEmail: React.Dispatch<React.SetStateAction<string>>
    setMessage: React.Dispatch<React.SetStateAction<AuthErrorMsgType>>
    authErrorMsg: (error: any) => void
    setIsLoginCodeVisible: React.Dispatch<React.SetStateAction<boolean>>
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
}

export interface SocialAuthProps {
    isLoading: boolean
    authErrorMsg: (error: any) => void
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
}
