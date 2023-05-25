// hooks/useResetApp.ts
import { useContext } from 'react';
import { useRouter } from 'next/router';
import AppContext from '@/contexts/appContext';

const useResetApp = () => {
    const router = useRouter();
    const { setApp } = useContext(AppContext);

    const resetApp = () => {
        setApp('');
        router.push('/');
    }

    return resetApp;
};

export default useResetApp;
