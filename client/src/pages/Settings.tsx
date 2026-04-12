import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Bell,
  Clock,
  DollarSign,
  LogIn,
  Save,
  Settings as SettingsIcon,
  Shield,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function Settings() {
  const { isAuthenticated, user } = useAuth();

  const settings = trpc.settings.get.useQuery(undefined, { enabled: isAuthenticated });
  const syncStatus = trpc.sync.status.useQuery();

  const [refreshInterval, setRefreshInterval] = useState(24);
  const [profitThreshold, setProfitThreshold] = useState(10);
  const [cpscEnabled, setCpscEnabled] = useState(true);
  const [nhtsaEnabled, setNhtsaEnabled] = useState(true);

  useEffect(() => {
    if (settings.data) {
      setRefreshInterval(settings.data.refreshIntervalHours ?? 24);
      setProfitThreshold(
        settings.data.profitThreshold ? parseFloat(String(settings.data.profitThreshold)) : 10
      );
      const agencies = (settings.data.preferredAgencies as string[]) ?? ["CPSC", "NHTSA"];
      setCpscEnabled(agencies.includes("CPSC"));
      setNhtsaEnabled(agencies.includes("NHTSA"));
    }
  }, [settings.data]);

  const updateSettings = trpc.settings.update.useMutation({
    onSuccess: () => toast.success("Settings saved."),
    onError: () => toast.error("Failed to save settings."),
  });

  const triggerSync = trpc.sync.triggerSync.useMutation({
    onSuccess: () => toast.success("Sync started."),
    onError: () => toast.error("Sync failed."),
  });

  const handleSave = () => {
    const agencies: string[] = [];
    if (cpscEnabled) agencies.push("CPSC");
    if (nhtsaEnabled) agencies.push("NHTSA");

    updateSettings.mutate({
      refreshIntervalHours: refreshInterval,
      profitThreshold,
      preferredAgencies: agencies,
    });
  };

  if (!isAuthenticated) {
    return (
      <AppLayout>
        <div className="p-6 flex flex-col items-center justify-center h-full min-h-96">
          <SettingsIcon className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Sign in to manage settings</h2>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
            Settings are saved per account and persist across sessions.
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
      <div className="p-6 space-y-6 max-w-2xl">
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure data refresh, profit thresholds, and agency preferences
          </p>
        </div>

        {/* Data Refresh */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Data Refresh Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {settings.isLoading ? (
              <Skeleton className="h-16 w-full bg-muted" />
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Refresh Interval (hours)
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min="1"
                      max="168"
                      value={refreshInterval}
                      onChange={(e) => setRefreshInterval(parseInt(e.target.value) || 24)}
                      className="w-28 h-8 text-sm bg-muted border-border"
                    />
                    <span className="text-xs text-muted-foreground">
                      {refreshInterval === 24
                        ? "Daily (recommended)"
                        : refreshInterval <= 6
                        ? "Frequent — may hit rate limits"
                        : refreshInterval >= 72
                        ? "Weekly or less"
                        : `Every ${refreshInterval} hours`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Minimum: 1 hour · Maximum: 168 hours (1 week)
                  </p>
                </div>

                <Separator className="bg-border" />

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-foreground">Scheduler Status</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {syncStatus.data?.scheduler?.isScheduled
                        ? `Running · Next sync: ${syncStatus.data.scheduler.nextRunAt ? new Date(syncStatus.data.scheduler.nextRunAt).toLocaleString() : "—"}`
                        : "Not scheduled"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => triggerSync.mutate({ agency: "ALL" })}
                    disabled={triggerSync.isPending}
                  >
                    Sync Now
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Profit Threshold */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Profit Threshold
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {settings.isLoading ? (
              <Skeleton className="h-16 w-full bg-muted" />
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Minimum Profit Margin (%)
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={profitThreshold}
                      onChange={(e) => setProfitThreshold(parseFloat(e.target.value) || 10)}
                      className="w-28 h-8 text-sm bg-muted border-border"
                    />
                    <span className="text-xs text-muted-foreground">
                      Recalls with margin ≥ {profitThreshold}% are flagged as opportunities
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Default: 10% · Items below this threshold are still shown but not highlighted
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Agency Preferences */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Agency Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {settings.isLoading ? (
              <Skeleton className="h-24 w-full bg-muted" />
            ) : (
              <>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">CPSC</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Consumer Product Safety Commission — household goods, electronics, appliances
                    </p>
                  </div>
                  <Switch checked={cpscEnabled} onCheckedChange={setCpscEnabled} />
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">NHTSA</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      National Highway Traffic Safety Administration — vehicles &amp; auto parts
                    </p>
                  </div>
                  <Switch checked={nhtsaEnabled} onCheckedChange={setNhtsaEnabled} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Account info */}
        <Card className="bg-card border-border">
          <CardHeader className="px-5 py-4 border-b border-border">
            <CardTitle className="text-sm font-semibold">Account</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-sm font-semibold text-primary">
                  {user?.name?.charAt(0) || "U"}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{user?.name || "User"}</p>
                <p className="text-xs text-muted-foreground">{user?.email || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateSettings.isPending} className="gap-2">
            <Save className="w-4 h-4" />
            {updateSettings.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
