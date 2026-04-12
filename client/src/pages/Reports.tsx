import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import {
  Download,
  FileText,
  Filter,
  LogIn,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ReportFilters {
  agency: string;
  dateFrom: string;
  dateTo: string;
  minProfitThreshold: string;
  category: string;
  onlyWithRefund: boolean;
}

export default function Reports() {
  const { isAuthenticated } = useAuth();
  const [reportName, setReportName] = useState(`Recall Report ${new Date().toLocaleDateString()}`);
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [filters, setFilters] = useState<ReportFilters>({
    agency: "ALL",
    dateFrom: "",
    dateTo: "",
    minProfitThreshold: "10",
    category: "",
    onlyWithRefund: false,
  });

  const reportsList = trpc.reports.list.useQuery(undefined, { enabled: isAuthenticated });

  const createReport = trpc.reports.create.useMutation({
    onSuccess: (data) => {
      toast.success("Report generated!", {
        description: `${data.rowCount} records. Click to download.`,
        action: {
          label: "Download",
          onClick: () => window.open(data.fileUrl, "_blank"),
        },
      });
      reportsList.refetch();
    },
    onError: (err) => toast.error(`Report failed: ${err.message}`),
  });

  const handleGenerate = () => {
    if (!reportName.trim()) {
      toast.error("Please enter a report name.");
      return;
    }
    createReport.mutate({
      name: reportName,
      format,
      filters: {
        agency: filters.agency !== "ALL" ? [filters.agency] : undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        minProfitThreshold: filters.minProfitThreshold ? parseFloat(filters.minProfitThreshold) : undefined,
        category: filters.category || undefined,
        onlyWithRefund: filters.onlyWithRefund || undefined,
      },
    });
  };

  if (!isAuthenticated) {
    return (
      <AppLayout>
        <div className="p-6 flex flex-col items-center justify-center h-full min-h-96">
          <FileText className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Sign in to generate reports</h2>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
            Reports are saved to your account and can be downloaded at any time.
          </p>
          <a href={getLoginUrl()}>
            <Button>
              <LogIn className="w-4 h-4 mr-2" />
              Sign In
            </Button>
          </a>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-4xl">
        <div>
          <h1 className="text-xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Generate filtered recall opportunity reports in CSV or PDF format
          </p>
        </div>

        {/* Report builder */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              New Report
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-5">
            {/* Name + format */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Report Name</Label>
                <Input
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  className="h-8 text-sm bg-muted border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Export Format</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as "csv" | "pdf")}>
                  <SelectTrigger className="h-8 text-sm bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV (Spreadsheet)</SelectItem>
                    <SelectItem value="pdf">PDF (Print-ready)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator className="bg-border" />

            {/* Filters */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                <Filter className="w-3 h-3" />
                Filters
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Agency</Label>
                  <Select
                    value={filters.agency}
                    onValueChange={(v) => setFilters((f) => ({ ...f, agency: v }))}
                  >
                    <SelectTrigger className="h-8 text-sm bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Agencies</SelectItem>
                      <SelectItem value="CPSC">CPSC Only</SelectItem>
                      <SelectItem value="NHTSA">NHTSA Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Date From</Label>
                  <Input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                    className="h-8 text-sm bg-muted border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Date To</Label>
                  <Input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                    className="h-8 text-sm bg-muted border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Min Profit Margin (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={filters.minProfitThreshold}
                    onChange={(e) => setFilters((f) => ({ ...f, minProfitThreshold: e.target.value }))}
                    className="h-8 text-sm bg-muted border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Category</Label>
                  <Input
                    placeholder="e.g. Vehicle, Electronics"
                    value={filters.category}
                    onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                    className="h-8 text-sm bg-muted border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Only With Refund Value</Label>
                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      checked={filters.onlyWithRefund}
                      onCheckedChange={(v) => setFilters((f) => ({ ...f, onlyWithRefund: v }))}
                    />
                    <span className="text-xs text-muted-foreground">
                      {filters.onlyWithRefund ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleGenerate}
                disabled={createReport.isPending}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                {createReport.isPending ? "Generating..." : `Generate ${format.toUpperCase()}`}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Past reports */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold">Previous Reports</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {reportsList.isLoading ? (
              <div className="p-5 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-muted" />
                ))}
              </div>
            ) : !reportsList.data || reportsList.data.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">No reports generated yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {reportsList.data.map((report) => (
                  <div key={report.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/20">
                    <div>
                      <p className="text-sm font-medium text-foreground">{report.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(report.createdAt).toLocaleString()} ·{" "}
                        {report.format?.toUpperCase()} ·{" "}
                        {report.rowCount ?? 0} records ·{" "}
                        <span
                          className={cn(
                            "font-medium",
                            report.status === "ready"
                              ? "text-emerald-400"
                              : report.status === "error"
                              ? "text-red-400"
                              : "text-yellow-400"
                          )}
                        >
                          {report.status}
                        </span>
                      </p>
                    </div>
                    {report.status === "ready" && report.fileUrl && (
                      <a href={report.fileUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                          <Download className="w-3 h-3" />
                          Download
                        </Button>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
