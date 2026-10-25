export type ProductVariantRow = {
  id: string;
  shopId: string;
  sourceItemId: string;
  sourceModelId: string;
  name: string;
  nameObservedAt: string;
  sku: string;
  cost: number | null;
  units: number;
};

export type ProductGroup = {
  id: string;
  sourceItemId: string;
  name: string;
  units: number;
  missingCosts: number;
  minCost: number | null;
  maxCost: number | null;
  variants: ProductVariantRow[];
};

// Names and SKUs can change or be shared. Only Shopee identity groups products.
export function groupProducts(variants: ProductVariantRow[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  for (const variant of variants) {
    const id = JSON.stringify([variant.shopId, variant.sourceItemId]);
    let group = groups.get(id);
    if (!group) {
      group = { id, sourceItemId: variant.sourceItemId, name: variant.name, units: 0, missingCosts: 0, minCost: null, maxCost: null, variants: [] };
      groups.set(id, group);
    }
    group.variants.push(variant);
    group.units += variant.units;
    if (variant.cost === null) group.missingCosts++;
    else {
      group.minCost = group.minCost === null ? variant.cost : Math.min(group.minCost, variant.cost);
      group.maxCost = group.maxCost === null ? variant.cost : Math.max(group.maxCost, variant.cost);
    }
  }
  for (const group of groups.values()) {
    // Use the newest imported checkout title regardless of sync order or report dates.
    const latest = [...group.variants].sort((a, b) => b.nameObservedAt.localeCompare(a.nameObservedAt) || a.id.localeCompare(b.id))[0];
    group.name = latest.name;
    group.variants.sort((a, b) => b.units - a.units || a.sourceModelId.localeCompare(b.sourceModelId));
  }
  return [...groups.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
