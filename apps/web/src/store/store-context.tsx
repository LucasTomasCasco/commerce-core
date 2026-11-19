import { createContext, useContext } from "react";

export type StoreInfo = {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "active" | "suspended";
  currencyCode: string;
};

export type StoreContextValue = {
  storeId: string;
  store: StoreInfo;
  roleName: string;
  isOwner: boolean;
  permissions: string[];
  can: (permission: string) => boolean;
};

export const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore(): StoreContextValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore debe usarse dentro de StoreLayout");
  return value;
}
