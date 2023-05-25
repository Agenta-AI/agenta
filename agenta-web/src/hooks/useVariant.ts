import { useState, useEffect } from 'react';
import { Parameter, getVariantParameters, saveNewVariant } from '@/services/api';
import { Variant } from '@/components/Playground/VersionTabs';

/**
 * Hook for using the variant.
 * @param appName 
 * @param variantName 
 * @param sourceVariantName The original variant name, this is important for determining the URI path
 * @returns 
 */
export function useVariant(appName: string, variant: Variant) {
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
                const { initOptParams, inputParams } = await getVariantParameters(appName, variant);
                setOptParams(initOptParams);
                setInputParams(inputParams);
                setURIPath(`${appName}/${variant.templateVariantName ? variant.templateVariantName : variant.variantName}`);
            } catch (error: any) {
                setIsError(true);
                setError(error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchParameters();
    }, [appName, variant]);

    /**
     * Saves new values for the optional parameters of the variant.
     * @param updatedOptParams 
     * @param persist 
     */
    const saveOptParams = async (updatedOptParams: Parameter[], persist: boolean) => {
        console.log(updatedOptParams);
        setIsLoading(true);
        setIsError(false);
        try {
            if (persist) {
                await saveNewVariant(appName, variant, updatedOptParams);
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

