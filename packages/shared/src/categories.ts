// Canonical request categories (spec §7). The `slug` is the stable key the
// frontend uses to look up the design's color tokens; `color` is the light-theme
// foreground hex stored on the row for any non-token consumer.

export interface CategorySeed {
  slug: string;
  name: string;
  color: string;
}

export const CATEGORIES: readonly CategorySeed[] = [
  { slug: "exchange", name: "Exchange", color: "#8A4B26" },
  { slug: "shipping", name: "Shipping Status", color: "#2C5680" },
  { slug: "sizing", name: "Sizing", color: "#6B4A86" },
  { slug: "discount", name: "Discount", color: "#85661F" },
  { slug: "other", name: "Other", color: "#5C574F" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
