import type { DisplayCurrency } from "@shopro/contracts";

export declare function faNumber(value: number | string | bigint): string;
export declare function money(amount: string | bigint | null | undefined, currency?: DisplayCurrency): string;
