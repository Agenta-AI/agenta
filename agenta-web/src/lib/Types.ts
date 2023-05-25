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
