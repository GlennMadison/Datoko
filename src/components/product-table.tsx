"use client";

import { Fragment, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProductGroup } from "@/core/products";
import { rupiah } from "@/lib/format";
import { Badge } from "@/components/ui";
import { CostForm } from "@/components/cost-form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function ProductCost({ product }: { product: ProductGroup }) {
  return <div className="space-y-1">
    {product.minCost !== null && <div>{product.minCost === product.maxCost ? rupiah(product.minCost) : `${rupiah(product.minCost)} – ${rupiah(product.maxCost)}`}</div>}
    {product.missingCosts > 0 && <Badge tone="orange">{product.missingCosts} {product.missingCosts === 1 ? "cost" : "costs"} missing</Badge>}
  </div>;
}

export function ProductTable({ products, disabled }: { products: ProductGroup[]; disabled: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const prefix = useId();
  function toggle(id: string) {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return <div className="table-scroll" tabIndex={0}>
    <Table aria-label="Product costs"><TableHeader><TableRow>
      <TableHead>Product</TableHead><TableHead>Units sold</TableHead><TableHead>Current unit cost</TableHead><TableHead>New cost / IDR</TableHead>
    </TableRow></TableHeader><TableBody>{products.map((product, index) => {
      const open = expanded.has(product.id);
      const detailsId = `${prefix}-${index}`;
      const single = product.variants.length === 1;
      return <Fragment key={product.id}>
        <TableRow>
          <TableCell className="min-w-64 max-w-lg whitespace-normal">
            {single ? <strong>{product.name}</strong> : <button type="button" className="flex items-start gap-2 text-left font-semibold rounded-sm focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={open} aria-controls={open ? detailsId : undefined} aria-label={`${open ? "Hide" : "Show"} variations for ${product.name}`} onClick={() => toggle(product.id)}>
              {open ? <ChevronDown size={16} className="mt-0.5 shrink-0" aria-hidden="true"/> : <ChevronRight size={16} className="mt-0.5 shrink-0" aria-hidden="true"/>}{product.name}
            </button>}
            <div className="subtext">{product.variants.length} {single ? "variation" : "variations"} · Product ID: {product.sourceItemId}</div>
            {single && <div className="subtext">{product.variants[0].variationName ?? (product.variants[0].sku === "No SKU" ? "" : product.variants[0].sku)}</div>}
          </TableCell>
          <TableCell>{product.units}</TableCell>
          <TableCell><ProductCost product={product}/></TableCell>
          <TableCell>{single ? <CostForm variantId={product.variants[0].id} name={product.name} disabled={disabled}/> : <button type="button" className="text-link" aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={() => toggle(product.id)}>{open ? "Hide variations" : "Manage variations"}</button>}</TableCell>
        </TableRow>
        {open && !single && <TableRow id={detailsId} className="bg-muted/20"><TableCell colSpan={4} className="p-0">
          <Table aria-label={`Variations for ${product.name}`}><TableHeader><TableRow><TableHead>Variation / SKU</TableHead><TableHead>Units sold</TableHead><TableHead>Current unit cost</TableHead><TableHead>New cost / IDR</TableHead></TableRow></TableHeader>
            <TableBody>{product.variants.map(variant => {
              const label = variant.variationName || (variant.sku !== "No SKU" ? variant.sku : variant.sourceModelId === "0" ? "No variation" : "Name not synced");
              return <TableRow key={variant.id}><TableCell><strong>{label}</strong>{variant.sku !== "No SKU" && variant.sku !== label && <div className="subtext">SKU: {variant.sku}</div>}<div className="subtext">Variation ID: {variant.sourceModelId}</div></TableCell><TableCell>{variant.units}</TableCell><TableCell>{variant.cost === null ? <Badge tone="orange">Cost missing</Badge> : rupiah(variant.cost)}</TableCell><TableCell><CostForm variantId={variant.id} name={`${product.name} (${label}, ${variant.sourceModelId})`} disabled={disabled}/></TableCell></TableRow>;
            })}</TableBody>
          </Table>
        </TableCell></TableRow>}
      </Fragment>;
    })}</TableBody></Table>
  </div>;
}
