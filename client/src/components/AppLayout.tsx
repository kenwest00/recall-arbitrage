import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BarChart3,
  FileText,
  Home,
  LogIn,
  LogOut,
  RefreshCw,
  Settings,
  TrendingUp,
  User,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/opportunities", label: "Opportunities", icon: TrendingUp },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();

  const syncStatus = trpc.sync.status.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const triggerSync = trpc.sync.triggerSync.useMutation({
    onSuccess: () => {
      toast.success("Sync triggered — recall data is refreshing.");
      syncStatus.refetch();
    },
    onError: () => toast.error("Sync failed. Please try again."),
  });

  const isRunning = syncStatus.data?.scheduler?.isRunning;

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-sidebar">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm font-bold text-sidebar-foreground leading-none">RecallArb</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Refund Intelligence</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = location === href || (href !== "/" && location.startsWith(href));
            return (
              <Link key={href} href={href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-sidebar-accent text-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Sync status */}
        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Data Sync</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0",
                isRunning ? "border-yellow-600 text-yellow-400" : "border-emerald-700 text-emerald-400"
              )}
            >
              {isRunning ? "Running" : "Idle"}
            </Badge>
          </div>
          {syncStatus.data?.scheduler?.lastRunAt && (
            <p className="text-[10px] text-muted-foreground mb-2">
              Last: {new Date(syncStatus.data.scheduler.lastRunAt).toLocaleString()}
            </p>
          )}
          {isAuthenticated && (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={() => triggerSync.mutate({ agency: "ALL" })}
              disabled={triggerSync.isPending || isRunning}
            >
              <RefreshCw className={cn("w-3 h-3 mr-1.5", triggerSync.isPending && "animate-spin")} />
              Sync Now
            </Button>
          )}
        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-sidebar-border">
          {isAuthenticated ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <User className="w-3 h-3 text-primary" />
                </div>
                <span className="text-xs text-sidebar-foreground truncate">{user?.name || user?.email || "User"}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => logout()}
                title="Sign out"
              >
                <LogOut className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <a href={getLoginUrl()}>
              <Button size="sm" className="w-full h-7 text-xs">
                <LogIn className="w-3 h-3 mr-1.5" />
                Sign In
              </Button>
            </a>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
