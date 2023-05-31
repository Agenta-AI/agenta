export interface Dataset {
    id: string;
    name: string;
    created_date?: string;
}

export interface AppVariant {
    id: number;
    name: string;
    endpoint: string;
}

export interface Variant {
    variantName: string;
    templateVariantName: string | null; // template name of the variant in case it has a precursor. Needed to compute the URI path
    persistent: boolean;  // whether the variant is persistent in the backend or not
    parameters: Record<string, string> | null;  // parameters of the variant. Only set in the case of forked variants
}

export interface Parameter {
    name: string;
    type: string;
    input: boolean;
    required: boolean;
    default?: any;
}
