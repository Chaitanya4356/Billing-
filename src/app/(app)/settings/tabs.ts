/** Settings sections. Later tasks append their own tabs here (Receipt preview, Users, Audit). */
export const SETTINGS_TABS = [
  { id: "shop", label: "Shop" },
  { id: "numbering", label: "Numbering" },
  { id: "gst", label: "GST" },
  { id: "discounts", label: "Discounts" },
  { id: "receipt", label: "Receipt text" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

/** Unknown or missing ?tab= values fall back to the first tab. */
export function resolveTab(raw: string | string[] | undefined): SettingsTabId {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return SETTINGS_TABS.find((t) => t.id === value)?.id ?? SETTINGS_TABS[0].id;
}
