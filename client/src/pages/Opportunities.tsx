import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Car,
  ChevronRight,
  DollarSign,
  Package,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

function AgencyBadge({ agency }: { agency: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
        agency === "CPSC"
          ? "bg-blue-900/40 text-blue-300 border border-blue-700/40"
          : "bg-orange-900/40 text-orange-300 border border-orange-700/40"
      )}
    >
      {agency === "NHTSA" ? <Car className="w-3 h-3" /> : <Package className="w-3 h-3" />}
      {agency}
    </span>
  );
}

export default function Opportunities() {
  const [, navigate] = useLocation();
  const [threshold, setThreshold] = useState(10);

  const opps = trpc.analysis.opportunities.useQuery({
    profitThreshold: threshold,
    limit: 100,
  });

  const rows = opps.data?.rows ?? [];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">Profit Opportunities</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Recalls where the used market purchase price is significantly below the refund value
          </p>
        </div>

        {/* Threshold control */}
        <Card className="bg-card border-border">
          <CardContent className="p-5">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Minimum Profit Margin</span>
              </div>
              <div className="flex-1 max-w-xs">
                <Slider
                  value={[threshold]}
                  onValueChange={([v]) => setThreshold(v)}
                  min={0}
                  max={80}
                  step={5}
                  className="w-full"
                />
              </div>
              <div className="w-16 text-center">
                <span className="text-2xl font-bold text-primary">{threshold}%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Showing {rows.length} recall{rows.length !== 1 ? "s" : ""} with ≥{threshold}% margin
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Opportunities grid */}
        {opps.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 bg-muted rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="p-12 text-center">
              <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No opportunities found at {threshold}% threshold. Try lowering the minimum margin.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((row) => {
              const margin = row.profitMargin ? parseFloat(String(row.profitMargin)) : null;
              const profit = row.profitAmount ? parseFloat(String(row.profitAmount)) : null;
              const refund = row.refundValue ? parseFloat(String(row.refundValue)) : null;
              const used = row.avgUsedPrice ? parseFloat(String(row.avgUsedPrice)) : null;

              const marginColor =
                margin !== null && margin >= 40
                  ? "text-emerald-400"
                  : margin !== null && margin >= 20
                  ? "text-yellow-400"
                  : "text-orange-400";

              return (
                <Card
                  key={row.id}
                  className="bg-card border-border hover:border-primary/40 transition-colors cursor-pointer group"
                  onClick={() => navigate(`/recalls/${row.id}`)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <AgencyBadge agency={row.agency} />
                      <span className={cn("text-2xl font-bold", marginColor)}>
                        {margin !== null ? `${margin.toFixed(1)}%` : "—"}
                      </span>
                    </div>

                    <h3 className="font-semibold text-foreground text-sm leading-snug mb-1 line-clamp-2">
                      {row.productName || row.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mb-4">
                      #{row.recallNumber}
                      {row.manufacturer ? ` · ${row.manufacturer}` : ""}
                    </p>

                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-muted/50 rounded-md p-2">
                        <p className="text-[10px] text-muted-foreground mb-0.5">Refund</p>
                        <p className="text-sm font-semibold text-emerald-400">
                          {refund !== null ? `$${refund.toFixed(2)}` : "—"}
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-md p-2">
                        <p className="text-[10px] text-muted-foreground mb-0.5">Buy For</p>
                        <p className="text-sm font-semibold text-foreground">
                          {used !== null ? `$${used.toFixed(2)}` : "—"}
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-md p-2">
                        <p className="text-[10px] text-muted-foreground mb-0.5">Profit</p>
                        <p className="text-sm font-semibold text-primary">
                          {profit !== null ? `$${profit.toFixed(2)}` : "—"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-muted-foreground">
                        {row.totalCount ?? 0} listings available
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
