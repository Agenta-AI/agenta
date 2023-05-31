import { useState, useEffect } from 'react';
import { getVariantParameters, saveNewVariant, updateVariantParams } from '@/lib/services/api';
import { Variant, Parameter } from '@/lib/Types';

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
    const [isParamSaveLoading, setIsParamSaveLoading] = useState(false);

    useEffect(() => {
        const fetchParameters = async () => {
            setIsLoading(true);
            setIsError(false);
            try {

                const { initOptParams, inputParams } = await getVariantParameters(appName, variant);

                if (variant.parameters) {
                    const updatedInitOptParams = initOptParams.map((param) => {
                        return variant.parameters && variant.parameters.hasOwnProperty(param.name)
                            ? { ...param, default: variant.parameters[param.name] }
                            : param;
                    });
                    setOptParams(updatedInitOptParams);
                } else {
                    setOptParams(initOptParams);
                }

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
    const saveOptParams = async (updatedOptParams: Parameter[], persist: boolean, updateVariant: boolean) => {
        console.log(updatedOptParams);
        setIsParamSaveLoading(true);
        setIsError(false);
        try {
            if (persist && !updateVariant) {
                await saveNewVariant(appName, variant, updatedOptParams);
            } else if (persist && !updateVariant) {
                await updateVariantParams(appName, variant, updatedOptParams);
            }
            setOptParams(updatedOptParams);
        } catch (error) {
            setIsError(true);
        } finally {
            setIsParamSaveLoading(false);
        }
    };

    return { inputParams, optParams, URIPath, isLoading, isError, error, isParamSaveLoading, saveOptParams };
}

