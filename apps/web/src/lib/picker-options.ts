import type { CursorPage } from "@shopro/contracts";
import { get } from "./api.js";
import type { PickerOptionLoader } from "../components/OptionPicker.js";

export function partyPicker(type: "CUSTOMER" | "SUPPLIER" | "BOTH") {
  const businessId = sessionStorage.getItem("shopro_business_id") ?? "none";
  const load: PickerOptionLoader = async (search, cursor) => {
    const query = new URLSearchParams({ type, limit: "40", q: search });
    if (cursor) query.set("cursor", cursor);
    const page = await get<CursorPage<{ id: string; name: string }>>(`/parties?${query.toString()}`);
    return { ...page, items: page.items.map((row) => ({ value: row.id, label: row.name })) };
  };
  return { key: `party:${businessId}:${type}`, load };
}

export function productPicker(kind?: "STOCK" | "SERVICE") {
  const businessId = sessionStorage.getItem("shopro_business_id") ?? "none";
  const load: PickerOptionLoader = async (search, cursor) => {
    const query = new URLSearchParams({ limit: "40", q: search });
    if (kind) query.set("kind", kind);
    if (cursor) query.set("cursor", cursor);
    const page = await get<CursorPage<{ id: string; name: string }>>(`/products?${query.toString()}`);
    return { ...page, items: page.items.map((row) => ({ value: row.id, label: row.name })) };
  };
  return { key: `product:${businessId}:${kind ?? "all"}`, load };
}
