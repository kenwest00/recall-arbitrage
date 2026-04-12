import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  Car,
  ChevronRight,
  DollarSign,
  ExternalLink,
  Filter,
  Package,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string | number | null;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{title}</p>
            <p className={cn("text-2xl font-bold", accent || "text-foreground")}>
              {value ?? "—"}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfitBadge({ margin }: { margin: number | null }) {
  if (margin === null) return <span className="text-muted-foreground text-xs">—</span>;
  const color =
    margin >= 30
      ? "text-emerald-400"
      : margin >= 10
      ? "text-yellow-400"
      : "text-red-400";
  return <span className={cn("font-semibold text-sm", color)}>{margin.toFixed(1)}%</span>;
}

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

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [agency, setAgency] = useState<string>("ALL");
  const [onlyRefund, setOnlyRefund] = useState(false);
  const [onlyOpps, setOnlyOpps] = useState(false);
  const [threshold] = useState(10);

  const stats = trpc.analysis.dashboard.useQuery({ profitThreshold: threshold });

  const recalls = trpc.recalls.list.useQuery({
    search: search || undefined,
    agency: agency !== "ALL" ? [agency] : undefined,
    onlyWithRefund: onlyRefund || undefined,
    onlyOpportunities: onlyOpps || undefined,
    profitThreshold: threshold,
    limit: 100,
  });

  const triggerSync = trpc.sync.triggerSync.useMutation({
    onSuccess: () => {
      toast.success("Sync started — data will refresh shortly.");
      recalls.refetch();
      stats.refetch();
    },
    onError: () => toast.error("Sync failed."),
  });

  const rows = recalls.data?.rows ?? [];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Recall Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Monitor federal recall refund opportunities across CPSC and NHTSA
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerSync.mutate({ agency: "ALL" })}
            disabled={triggerSync.isPending}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", triggerSync.isPending && "animate-spin")} />
            Refresh Data
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Recalls Tracked"
            value={stats.data?.totalRecalls ?? null}
            icon={AlertTriangle}
          />
          <StatCard
            title="Opportunities Found"
            value={stats.data?.opportunitiesFound ?? null}
            sub={`≥${threshold}% margin`}
            icon={TrendingUp}
            accent="text-emerald-400"
          />
          <StatCard
            title="Avg Profit Margin"
            value={stats.data?.avgMargin !== null && stats.data?.avgMargin !== undefined ? `${stats.data.avgMargin}%` : null}
            icon={DollarSign}
            accent="text-yellow-400"
          />
          <StatCard
            title="With Refund Value"
            value={stats.data?.withRefundValue ?? null}
            sub="Extracted from notice"
            icon={Package}
          />
        </div>

        {/* Filters */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search product, manufacturer, recall #..."
                  className="pl-9 h-8 text-sm bg-muted border-border"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={agency} onValueChange={setAgency}>
                <SelectTrigger className="w-32 h-8 text-sm bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Agencies</SelectItem>
                  <SelectItem value="CPSC">CPSC</SelectItem>
                  <SelectItem value="NHTSA">NHTSA</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant={onlyRefund ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setOnlyRefund(!onlyRefund)}
              >
                <Filter className="w-3 h-3 mr-1.5" />
                Has Refund
              </Button>
              <Button
                size="sm"
                variant={onlyOpps ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setOnlyOpps(!onlyOpps)}
              >
                <TrendingUp className="w-3 h-3 mr-1.5" />
                Opportunities Only
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-primary"
                onClick={() => navigate("/opportunities")}
              >
                View All Opportunities
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recall Table */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">
                Recalls
                {recalls.data && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    ({rows.length} shown)
                  </span>
                )}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recalls.isLoading ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-muted" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center">
                <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No recalls found.{" "}
                  {!recalls.isLoading && (
                    <button
                      className="text-primary underline"
                      onClick={() => triggerSync.mutate({ agency: "ALL" })}
                    >
                      Trigger a sync
                    </button>
                  )}{" "}
                  to load data.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground w-28">Agency</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Product / Recall</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground w-28">Date</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground w-28">Refund</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground w-28">Avg Used</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground w-24">Margin</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground w-20">Listings</th>
                      <th className="w-10 px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const margin = row.profitMargin ? parseFloat(String(row.profitMargin)) : null;
                      const isOpp = margin !== null && margin >= threshold;
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            "border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors",
                            isOpp && "bg-emerald-950/20 border-l-2 border-l-emerald-600"
                          )}
                          onClick={() => navigate(`/recalls/${row.id}`)}
                        >
                          <td className="px-4 py-3">
                            <AgencyBadge agency={row.agency} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground truncate max-w-xs">
                              {row.productName || row.title}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              #{row.recallNumber}
                              {row.manufacturer ? ` · ${row.manufacturer}` : ""}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {row.recallDate ? new Date(row.recallDate).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.refundValue ? (
                              <span className="text-emerald-400 font-medium">
                                ${parseFloat(String(row.refundValue)).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                {row.refundExtracted ? "Full price" : "—"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground">
                            {row.avgUsedPrice
                              ? `$${parseFloat(String(row.avgUsedPrice)).toFixed(2)}`
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <ProfitBadge margin={margin} />
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                            {row.totalCount ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
