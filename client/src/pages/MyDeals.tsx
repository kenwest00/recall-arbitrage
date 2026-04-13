import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  ExternalLink,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
  TrendingUp,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClaimStatus = "not_started" | "submitted" | "pending" | "approved" | "received" | "denied";

type Deal = {
  id: number;
  recallId: number;
  recallNumber?: string | null;
  productName?: string | null;
  manufacturer?: string | null;
  refundValue?: string | null;
  purchasePrice?: string | null;
  shippingCost?: string | null;
  totalCost?: string | null;
  purchasePlatform?: string | null;
  purchaseUrl?: string | null;
  purchaseDate?: string | Date | null;
  claimStatus?: string | null;
  claimSubmittedDate?: string | Date | null;
  refundReceivedDate?: string | Date | null;
  refundReceivedAmount?: string | null;
  netProfit?: string | null;
  notes?: string | null;
  createdAt?: string | Date | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ClaimStatus, { label: string; color: string; bg: string }> = {
  not_started: { label: "Not Started", color: "text-muted-foreground", bg: "bg-muted/40" },
  submitted: { label: "Submitted", color: "text-blue-400", bg: "bg-blue-950/30 border border-blue-800/40" },
  pending: { label: "Pending", color: "text-yellow-400", bg: "bg-yellow-950/30 border border-yellow-800/40" },
  approved: { label: "Approved", color: "text-emerald-400", bg: "bg-emerald-950/30 border border-emerald-800/40" },
  received: { label: "Refund Received", color: "text-emerald-300", bg: "bg-emerald-950/40 border border-emerald-700/50" },
  denied: { label: "Denied", color: "text-red-400", bg: "bg-red-950/30 border border-red-800/40" },
};

const PLATFORM_LABELS: Record<string, string> = {
  ebay: "eBay",
  facebook: "Facebook",
  craigslist: "Craigslist",
  amazon: "Amazon",
  other: "Other",
};

function fmt(val: string | null | undefined) {
  if (!val) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function fmtDate(val: string | Date | null | undefined) {
  if (!val) return null;
  return new Date(val).toLocaleDateString();
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status || "not_started") as ClaimStatus;
  const cfg = STATUS_CONFIG[s] || STATUS_CONFIG.not_started;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.bg, cfg.color)}>
      {cfg.label}
    </span>
  );
}

// ─── Edit Deal Slide-over ─────────────────────────────────────────────────────

function EditDealPanel({ deal, onClose, onSaved }: { deal: Deal; onClose: () => void; onSaved: () => void }) {
  const [purchasePrice, setPurchasePrice] = useState(fmt(deal.purchasePrice)?.toFixed(2) ?? "");
  const [shippingCost, setShippingCost] = useState(fmt(deal.shippingCost)?.toFixed(2) ?? "0");
  const [platform, setPlatform] = useState(deal.purchasePlatform ?? "ebay");
  const [purchaseUrl, setPurchaseUrl] = useState(deal.purchaseUrl ?? "");
  const [claimStatus, setClaimStatus] = useState<ClaimStatus>((deal.claimStatus as ClaimStatus) ?? "not_started");
  const [claimSubmittedDate, setClaimSubmittedDate] = useState(
    deal.claimSubmittedDate ? new Date(deal.claimSubmittedDate).toISOString().split("T")[0] : ""
  );
  const [refundReceivedDate, setRefundReceivedDate] = useState(
    deal.refundReceivedDate ? new Date(deal.refundReceivedDate).toISOString().split("T")[0] : ""
  );
  const [refundReceivedAmount, setRefundReceivedAmount] = useState(
    fmt(deal.refundReceivedAmount)?.toFixed(2) ?? ""
  );
  const [notes, setNotes] = useState(deal.notes ?? "");

  const updateDeal = trpc.deals.update.useMutation({
    onSuccess: () => {
      toast.success("Deal updated.");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(`Update failed: ${e.message}`),
  });

  const refundValue = fmt(deal.refundValue);
  const totalCost = (parseFloat(purchasePrice) || 0) + (parseFloat(shippingCost) || 0);
  const actualRefund = refundReceivedAmount ? parseFloat(refundReceivedAmount) : null;
  const estProfit = actualRefund !== null ? actualRefund - totalCost : refundValue !== null ? refundValue - totalCost : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border-l border-border w-full max-w-lg h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="text-base font-semibold text-foreground">Edit Deal</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Product info */}
          <div className="bg-muted/40 rounded-lg p-3">
            <p className="font-medium text-foreground text-sm truncate">{deal.productName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              #{deal.recallNumber}
              {deal.manufacturer ? ` · ${deal.manufacturer}` : ""}
            </p>
            {refundValue && (
              <p className="text-xs text-emerald-400 mt-1">Refund value: ${refundValue.toFixed(2)}</p>
            )}
          </div>

          {/* Purchase details */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Purchase Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Purchase Price ($)</Label>
                <Input
                  type="number" step="0.01" value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  className="h-8 text-sm bg-muted border-border"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Shipping Cost ($)</Label>
                <Input
                  type="number" step="0.01" value={shippingCost}
                  onChange={(e) => setShippingCost(e.target.value)}
                  className="h-8 text-sm bg-muted border-border"
                />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="h-8 text-sm bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PLATFORM_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Listing URL</Label>
              <Input
                value={purchaseUrl} onChange={(e) => setPurchaseUrl(e.target.value)}
                placeholder="https://..."
                className="h-8 text-sm bg-muted border-border"
              />
            </div>
          </div>

          {/* Claim status */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Claim Status</p>
            <Select value={claimStatus} onValueChange={(v) => setClaimStatus(v as ClaimStatus)}>
              <SelectTrigger className="h-8 text-sm bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                  <SelectItem key={v} value={v}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(claimStatus === "submitted" || claimStatus === "pending" || claimStatus === "approved" || claimStatus === "received" || claimStatus === "denied") && (
              <div className="mt-3">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Claim Submitted Date</Label>
                <Input
                  type="date" value={claimSubmittedDate}
                  onChange={(e) => setClaimSubmittedDate(e.target.value)}
                  className="h-8 text-sm bg-muted border-border"
                />
              </div>
            )}

            {claimStatus === "received" && (
              <>
                <div className="mt-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Refund Received Date</Label>
                  <Input
                    type="date" value={refundReceivedDate}
                    onChange={(e) => setRefundReceivedDate(e.target.value)}
                    className="h-8 text-sm bg-muted border-border"
                  />
                </div>
                <div className="mt-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Refund Amount Received ($)</Label>
                  <Input
                    type="number" step="0.01" value={refundReceivedAmount}
                    onChange={(e) => setRefundReceivedAmount(e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-sm bg-muted border-border"
                  />
                </div>
              </>
            )}
          </div>

          {/* Claim instructions */}
          {deal.notes !== undefined && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Claim Instructions</p>
              <div className="bg-muted/30 rounded-lg p-3 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span>Item purchased {fmtDate(deal.purchaseDate) ? `on ${fmtDate(deal.purchaseDate)}` : "(date not set)"}</span>
                </div>
                <div className={cn("flex items-center gap-2", claimStatus === "not_started" && "opacity-50")}>
                  {claimStatus !== "not_started" ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                  <span>Claim submitted {claimSubmittedDate ? `on ${new Date(claimSubmittedDate).toLocaleDateString()}` : "(not yet)"}</span>
                </div>
                <div className={cn("flex items-center gap-2", claimStatus !== "received" && "opacity-50")}>
                  {claimStatus === "received" ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                  <span>Refund received {refundReceivedDate ? `on ${new Date(refundReceivedDate).toLocaleDateString()}` : "(pending)"}</span>
                </div>
              </div>
              <div className="mt-3">
                <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (claim reference, contact info)</Label>
                <Input
                  value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Claim #12345, contact: recalls@brand.com"
                  className="h-8 text-sm bg-muted border-border"
                />
              </div>
            </div>
          )}

          {/* Profit summary */}
          {estProfit !== null && (
            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Total Cost</span>
                <span className="text-foreground">${totalCost.toFixed(2)}</span>
              </div>
              {actualRefund !== null ? (
                <div className="flex justify-between items-center mt-1">
                  <span className="text-muted-foreground text-xs">Refund Received</span>
                  <span className="text-emerald-400">${actualRefund.toFixed(2)}</span>
                </div>
              ) : refundValue !== null ? (
                <div className="flex justify-between items-center mt-1">
                  <span className="text-muted-foreground text-xs">Expected Refund</span>
                  <span className="text-emerald-400">${refundValue.toFixed(2)}</span>
                </div>
              ) : null}
              <div className="flex justify-between items-center mt-1 pt-1 border-t border-emerald-800/30">
                <span className="text-xs font-medium text-foreground">
                  {actualRefund !== null ? "Net Profit" : "Est. Profit"}
                </span>
                <span className={cn("font-bold", estProfit >= 0 ? "text-emerald-400" : "text-red-400")}>
                  ${estProfit.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 h-9" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm" className="flex-1 h-9"
              disabled={updateDeal.isPending}
              onClick={() =>
                updateDeal.mutate({
                  id: deal.id,
                  purchasePrice: purchasePrice ? parseFloat(purchasePrice) : undefined,
                  shippingCost: shippingCost ? parseFloat(shippingCost) : undefined,
                  purchasePlatform: platform as "ebay" | "facebook" | "craigslist" | "amazon" | "other",
                  purchaseUrl: purchaseUrl || undefined,
                  claimStatus: claimStatus,
                  claimSubmittedDate: claimSubmittedDate || undefined,
                  refundReceivedDate: refundReceivedDate || undefined,
                  refundReceivedAmount: refundReceivedAmount ? parseFloat(refundReceivedAmount) : undefined,
                  notes: notes || undefined,
                })
              }
            >
              {updateDeal.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MyDeals() {
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const deals = trpc.deals.getAll.useQuery();
  const summary = trpc.deals.getSummary.useQuery();

  const deleteDeal = trpc.deals.delete.useMutation({
    onSuccess: () => {
      toast.success("Deal removed.");
      deals.refetch();
      summary.refetch();
    },
    onError: (e) => toast.error(`Delete failed: ${e.message}`),
  });

  const rows = (deals.data ?? []) as Deal[];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">My Deals</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Track purchased items, claim submissions, and refunds received
            </p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Deals Tracked</p>
                  <p className="text-2xl font-bold text-foreground">{summary.data?.totalDeals ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">Items purchased</p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Capital Deployed</p>
                  <p className="text-2xl font-bold text-orange-400">
                    ${summary.data?.totalInvested?.toFixed(2) ?? "0.00"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Total invested</p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Pending Refunds</p>
                  <p className="text-2xl font-bold text-yellow-400">
                    ${summary.data?.pendingRefunds?.toFixed(2) ?? "0.00"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Claims submitted</p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Profit Banked</p>
                  <p className="text-2xl font-bold text-emerald-400">
                    ${summary.data?.profitBanked?.toFixed(2) ?? "0.00"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Refunds received</p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Deals table */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold text-foreground">
              All Deals
              {rows.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">({rows.length})</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {deals.isLoading ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full bg-muted" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center">
                <ShoppingCart className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No deals tracked yet. Find an opportunity above and click{" "}
                  <span className="text-primary">Track This Deal</span> to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-8 px-3 py-3"></th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Product</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground w-28">Platform</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground w-24">Paid</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground w-24">Refund</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground w-24">Profit</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground w-32">Status</th>
                      <th className="w-20 px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((deal) => {
                      const paid = fmt(deal.totalCost);
                      const refund = fmt(deal.refundValue);
                      const profit = fmt(deal.netProfit);
                      const isExpanded = expandedId === deal.id;
                      const status = (deal.claimStatus || "not_started") as ClaimStatus;

                      return (
                        <>
                          <tr
                            key={deal.id}
                            className={cn(
                              "border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors",
                              status === "received" && "bg-emerald-950/10"
                            )}
                            onClick={() => setExpandedId(isExpanded ? null : deal.id)}
                          >
                            <td className="px-3 py-3 text-muted-foreground">
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-foreground truncate max-w-xs">
                                {deal.productName || `Recall #${deal.recallNumber}`}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                #{deal.recallNumber}
                                {deal.manufacturer ? ` · ${deal.manufacturer}` : ""}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {PLATFORM_LABELS[deal.purchasePlatform ?? ""] || deal.purchasePlatform || "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-foreground">
                              {paid !== null ? `$${paid.toFixed(2)}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {refund !== null ? (
                                <span className="text-emerald-400">${refund.toFixed(2)}</span>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {profit !== null ? (
                                <span className={cn("font-semibold", profit >= 0 ? "text-emerald-400" : "text-red-400")}>
                                  ${profit.toFixed(2)}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={deal.claimStatus} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
                                {deal.purchaseUrl && (
                                  <a href={deal.purchaseUrl} target="_blank" rel="noopener noreferrer">
                                    <Button size="icon" variant="ghost" className="w-7 h-7">
                                      <ExternalLink className="w-3 h-3" />
                                    </Button>
                                  </a>
                                )}
                                <Button
                                  size="icon" variant="ghost" className="w-7 h-7"
                                  onClick={() => setEditDeal(deal)}
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="icon" variant="ghost"
                                  className="w-7 h-7 text-red-400 hover:text-red-300 hover:bg-red-950/30"
                                  onClick={() => {
                                    if (confirm("Remove this deal?")) {
                                      deleteDeal.mutate({ id: deal.id });
                                    }
                                  }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${deal.id}-expanded`} className="bg-muted/10 border-b border-border/30">
                              <td colSpan={8} className="px-6 py-4">
                                <div className="grid grid-cols-3 gap-4 text-xs">
                                  <div>
                                    <p className="text-muted-foreground mb-1 font-medium">Purchase Details</p>
                                    <p>Purchased: {fmtDate(deal.purchaseDate) || "—"}</p>
                                    <p>Price: ${fmt(deal.purchasePrice)?.toFixed(2) ?? "—"}</p>
                                    <p>Shipping: ${fmt(deal.shippingCost)?.toFixed(2) ?? "0.00"}</p>
                                    <p>Total Cost: ${fmt(deal.totalCost)?.toFixed(2) ?? "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground mb-1 font-medium">Claim Timeline</p>
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-1.5">
                                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                                        <span>Purchased {fmtDate(deal.purchaseDate) || "—"}</span>
                                      </div>
                                      <div className={cn("flex items-center gap-1.5", !deal.claimSubmittedDate && "opacity-40")}>
                                        {deal.claimSubmittedDate ? (
                                          <CheckCircle className="w-3 h-3 text-emerald-500" />
                                        ) : (
                                          <Clock className="w-3 h-3 text-muted-foreground" />
                                        )}
                                        <span>Submitted {fmtDate(deal.claimSubmittedDate) || "(not yet)"}</span>
                                      </div>
                                      <div className={cn("flex items-center gap-1.5", !deal.refundReceivedDate && "opacity-40")}>
                                        {deal.refundReceivedDate ? (
                                          <CheckCircle className="w-3 h-3 text-emerald-500" />
                                        ) : (
                                          <Clock className="w-3 h-3 text-muted-foreground" />
                                        )}
                                        <span>Received {fmtDate(deal.refundReceivedDate) || "(pending)"}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground mb-1 font-medium">Notes</p>
                                    <p className="text-foreground leading-relaxed">{deal.notes || "—"}</p>
                                    {deal.refundReceivedAmount && (
                                      <p className="mt-2 text-emerald-400 font-medium">
                                        Received: ${fmt(deal.refundReceivedAmount)?.toFixed(2)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {editDeal && (
        <EditDealPanel
          deal={editDeal}
          onClose={() => setEditDeal(null)}
          onSaved={() => {
            deals.refetch();
            summary.refetch();
          }}
        />
      )}
    </AppLayout>
  );
}
