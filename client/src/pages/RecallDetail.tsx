import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Car,
  ExternalLink,
  Package,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  ebay: { label: "eBay", color: "text-yellow-400" },
  amazon: { label: "Amazon", color: "text-orange-400" },
  facebook: { label: "Facebook", color: "text-blue-400" },
  ebaymotors: { label: "eBay Motors", color: "text-yellow-400" },
  rockauto: { label: "RockAuto", color: "text-red-400" },
  carpart: { label: "Car-Part.com", color: "text-cyan-400" },
  lkq: { label: "LKQ / Pick-n-Pull", color: "text-purple-400" },
};

function PlatformPriceCard({
  platform,
  avgPrice,
  count,
  isNhtsa,
}: {
  platform: string;
  avgPrice: number | null;
  count: number;
  isNhtsa: boolean;
}) {
  const info = PLATFORM_LABELS[platform] || { label: platform, color: "text-foreground" };
  return (
    <div className="bg-muted/40 rounded-lg p-4 border border-border/50">
      <p className={cn("text-xs font-medium mb-1", info.color)}>{info.label}</p>
      <p className="text-xl font-bold text-foreground">
        {avgPrice !== null ? `$${avgPrice.toFixed(2)}` : "—"}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{count} listing{count !== 1 ? "s" : ""}</p>
    </div>
  );
}

export default function RecallDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const recallId = parseInt(id || "0");

  const detail = trpc.recalls.getById.useQuery({ id: recallId }, { enabled: !!recallId });

  const refreshPricing = trpc.recalls.refreshPricing.useMutation({
    onSuccess: () => {
      toast.success("Pricing refreshed successfully.");
      detail.refetch();
    },
    onError: () => toast.error("Failed to refresh pricing."),
  });

  if (detail.isLoading) {
    return (
      <AppLayout>
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-48 bg-muted" />
          <Skeleton className="h-48 w-full bg-muted" />
          <Skeleton className="h-64 w-full bg-muted" />
        </div>
      </AppLayout>
    );
  }

  if (!detail.data) {
    return (
      <AppLayout>
        <div className="p-6">
          <p className="text-muted-foreground">Recall not found.</p>
        </div>
      </AppLayout>
    );
  }

  const { recall, analysis, pricing, msrp } = detail.data;
  const isNhtsa = recall.agency === "NHTSA";
  const margin = analysis?.profitMargin ? parseFloat(String(analysis.profitMargin)) : null;
  const profit = analysis?.profitAmount ? parseFloat(String(analysis.profitAmount)) : null;
  const refund = recall.refundValue ? parseFloat(String(recall.refundValue)) : null;
  const used = analysis?.avgUsedPrice ? parseFloat(String(analysis.avgUsedPrice)) : null;
  const msrpVal = analysis?.msrpValue ? parseFloat(String(analysis.msrpValue)) : null;

  const marginColor =
    margin !== null && margin >= 30
      ? "text-emerald-400"
      : margin !== null && margin >= 10
      ? "text-yellow-400"
      : "text-red-400";

  // Group pricing by platform
  const pricingByPlatform: Record<string, { prices: number[]; listings: typeof pricing }> = {};
  for (const p of pricing) {
    if (!pricingByPlatform[p.platform]) {
      pricingByPlatform[p.platform] = { prices: [], listings: [] };
    }
    const price = parseFloat(String(p.price));
    if (price > 0) pricingByPlatform[p.platform].prices.push(price);
    pricingByPlatform[p.platform].listings.push(p);
  }

  const platformAvgs: Record<string, { avg: number | null; count: number }> = {};
  for (const [plat, data] of Object.entries(pricingByPlatform)) {
    const avg =
      data.prices.length > 0
        ? data.prices.reduce((a, b) => a + b, 0) / data.prices.length
        : null;
    platformAvgs[plat] = { avg, count: data.prices.length };
  }

  // Determine which platforms to show
  const usedPlatforms = isNhtsa
    ? ["ebaymotors", "carpart", "lkq"]
    : ["ebay", "amazon", "facebook"];

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        {/* Back + header */}
        <div>
          <button
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Dashboard
          </button>

          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                    isNhtsa
                      ? "bg-orange-900/40 text-orange-300 border border-orange-700/40"
                      : "bg-blue-900/40 text-blue-300 border border-blue-700/40"
                  )}
                >
                  {isNhtsa ? <Car className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                  {recall.agency}
                </span>
                <span className="text-xs text-muted-foreground">#{recall.recallNumber}</span>
                {recall.recallDate && (
                  <span className="text-xs text-muted-foreground">
                    · {new Date(recall.recallDate).toLocaleDateString()}
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold text-foreground leading-snug">
                {recall.productName || recall.title}
              </h1>
              {recall.manufacturer && (
                <p className="text-sm text-muted-foreground mt-1">{recall.manufacturer}</p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {recall.recallUrl && (
                <a href={recall.recallUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-8 text-xs">
                    <ExternalLink className="w-3 h-3 mr-1.5" />
                    Official Notice
                  </Button>
                </a>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => refreshPricing.mutate({ recallId })}
                disabled={refreshPricing.isPending}
              >
                <RefreshCw className={cn("w-3 h-3 mr-1.5", refreshPricing.isPending && "animate-spin")} />
                Refresh Prices
              </Button>
            </div>
          </div>
        </div>

        {/* Profit summary */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Profit Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-muted/40 rounded-lg p-4 border border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Recall Refund</p>
                <p className="text-xl font-bold text-emerald-400">
                  {refund !== null ? `$${refund.toFixed(2)}` : "—"}
                </p>
                {recall.refundNotes && (
                  <p className="text-[10px] text-muted-foreground mt-1 leading-tight line-clamp-2">
                    {recall.refundNotes}
                  </p>
                )}
              </div>
              <div className="bg-muted/40 rounded-lg p-4 border border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Avg Used Price</p>
                <p className="text-xl font-bold text-foreground">
                  {used !== null ? `$${used.toFixed(2)}` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">Blended avg</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-4 border border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Est. Profit</p>
                <p className="text-xl font-bold text-primary">
                  {profit !== null ? `$${profit.toFixed(2)}` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">Per unit</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-4 border border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Profit Margin</p>
                <p className={cn("text-xl font-bold", marginColor)}>
                  {margin !== null ? `${margin.toFixed(1)}%` : "—"}
                </p>
              </div>
              <div className="bg-muted/40 rounded-lg p-4 border border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Open Market MSRP</p>
                <p className="text-xl font-bold text-foreground">
                  {msrpVal !== null ? `$${msrpVal.toFixed(2)}` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {msrp[0]?.source || "Market avg"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Platform pricing breakdown */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              {isNhtsa ? "Auto Parts Market Pricing" : "Used Market Pricing"}
              <span className="text-xs text-muted-foreground font-normal ml-1">
                {isNhtsa ? "(eBay Motors · Car-Part.com · LKQ)" : "(eBay · Amazon · Facebook)"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-5">
            {/* Platform avg cards */}
            <div className="grid grid-cols-3 gap-4">
              {usedPlatforms.map((plat) => (
                <PlatformPriceCard
                  key={plat}
                  platform={plat}
                  avgPrice={platformAvgs[plat]?.avg ?? null}
                  count={platformAvgs[plat]?.count ?? 0}
                  isNhtsa={isNhtsa}
                />
              ))}
            </div>

            {/* RockAuto MSRP baseline for NHTSA */}
            {isNhtsa && platformAvgs["rockauto"] && (
              <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-4">
                <p className="text-xs font-medium text-red-400 mb-1">RockAuto — New/Remanufactured Baseline</p>
                <p className="text-lg font-bold text-foreground">
                  {platformAvgs["rockauto"].avg !== null
                    ? `$${platformAvgs["rockauto"].avg.toFixed(2)}`
                    : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {platformAvgs["rockauto"].count} listings · Used as MSRP reference, not included in used avg
                </p>
              </div>
            )}

            {/* Individual listings table */}
            {pricing.length > 0 && (
              <>
                <Separator className="bg-border" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3">Individual Listings</p>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {pricing.map((p) => {
                      const info = PLATFORM_LABELS[p.platform] || { label: p.platform, color: "text-foreground" };
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between py-2 px-3 bg-muted/20 rounded hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={cn("text-xs font-medium w-24 flex-shrink-0", info.color)}>
                              {info.label}
                            </span>
                            <span className="text-xs text-foreground truncate">
                              {p.listingTitle || "—"}
                            </span>
                            {p.condition && (
                              <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                {p.condition}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-sm font-semibold text-foreground">
                              ${parseFloat(String(p.price)).toFixed(2)}
                            </span>
                            {p.listingUrl && (
                              <a
                                href={p.listingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-primary" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* MSRP sources */}
        {msrp.length > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="px-5 py-4 border-b border-border">
              <CardTitle className="text-sm font-semibold">Open Market MSRP Sources</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <div className="space-y-2">
                {msrp.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-2 px-3 bg-muted/20 rounded">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-muted-foreground w-28">{m.source}</span>
                      <span className="text-xs text-foreground">{m.productTitle}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-foreground">
                        ${parseFloat(String(m.msrpPrice)).toFixed(2)}
                      </span>
                      {m.productUrl && (
                        <a href={m.productUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-primary" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Full recall notice */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold">Full Recall Notice</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {recall.hazard && (
              <div>
                <p className="text-xs font-medium text-red-400 mb-1">Hazard</p>
                <p className="text-sm text-foreground">{recall.hazard}</p>
              </div>
            )}
            {recall.remedy && (
              <div>
                <p className="text-xs font-medium text-emerald-400 mb-1">Remedy</p>
                <p className="text-sm text-foreground">{recall.remedy}</p>
              </div>
            )}
            {recall.description && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                <p className="text-sm text-foreground leading-relaxed">{recall.description}</p>
              </div>
            )}
            {recall.rawNotice && recall.rawNotice !== recall.description && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Full Notice Text</p>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/30 p-3 rounded">
                  {recall.rawNotice}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
