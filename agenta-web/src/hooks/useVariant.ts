import { useState, useEffect } from 'react';
import { Parameter, fetchVariantParameters } from '@/services/api';


/**
 * Hook for using the variant.
 * @param appName 
 * @param variantName 
 * @param sourceVariantName The original variant name, this is important for determining the URI path
 * @returns 
 */
export function useVariant(appName: string, variantName: string, sourceVariantName: string | null = null) {
    const [optParams, setOptParams] = useState<Parameter[] | null>(null);
    const [inputParams, setInputParams] = useState<Parameter[] | null>(null);
    const [URIPath, setURIPath] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isError, setIsError] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    useEffect(() => {
        const fetchParameters = async () => {
            setIsLoading(true);
            setIsError(false);
            try {
                const { initOptParams, inputParams } = await fetchVariantParameters(appName, variantName);
                setOptParams(initOptParams);
                setInputParams(inputParams);
                setURIPath(`${appName}/${sourceVariantName ? sourceVariantName : variantName}`);
            } catch (error: any) {
                setIsError(true);
                setError(error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchParameters();
    }, [appName, variantName]);

    /**
     * Saves new values for the optional parameters of the variant.
     * @param updatedOptParams 
     * @param persist 
     */
    const saveOptParams = async (updatedOptParams: Parameter[], persist: boolean) => {
        setIsLoading(true);
        setIsError(false);
        try {
            if (persist) {
                // await updateVariantParameters(appName, variantName, updatedParameters);
            }
            setOptParams(updatedOptParams);
        } catch (error) {
            setIsError(true);
        } finally {
            setIsLoading(false);
        }
    };

    return { inputParams, optParams, URIPath, isLoading, isError, error, saveOptParams };
}

