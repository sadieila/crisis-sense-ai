import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle, Eye, FileText, Loader2, LogOut, RefreshCw,
  Download, Bot, Clock, Brain, Shield, X, BarChart3, Layers,
  Filter as FilterIcon, Pencil, Save, Activity,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { withApiBase } from "@/lib/apiUrl";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Types ──────────────────────────────────────────────────────────────────────

type Incident = {
  id: string; category: string; area: string;
  status: "active" | "monitoring" | "resolved";
  severity: number; report_count: number;
  ai_summary: string | null;
  analyst_notes: string | null;
  created_at: string; updated_at: string;
};

type IncidentReport = {
  id: string; title: string | null; content: string | null;
  category: string | null; area: string | null;
  status: string; created_at: string;
};

type IntelligenceSuggestion = {
  id: string;
  type: "cross_category_link" | "temporal_cluster" | "weak_signal" | "escalation_risk";
  title: string; description: string; area: string;
  categories_involved: string[];
  confidence: number;
  confidence_level: "عالية" | "متوسطة" | "منخفضة";
  reasoning: string; suggested_action: string;
  report_ids: string[];
};

type IntelScanResult = {
  suggestions: IntelligenceSuggestion[];
  reports_scanned: number;
  scan_duration_ms: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const CAT_ICONS: Record<string, string> = {
  "صحة": "🏥", "مياه وصرف صحي": "💧", "غذاء وتغذية": "🍞",
  "مأوى وخيم": "⛺", "الشتاء والتدفئة": "🔥",
  "الوصول للخدمات الطبية": "🚑", "لا أعرف / أخرى": "❓",
};

function catIcon(c: string) { return CAT_ICONS[c] ?? "❓"; }

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `منذ ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} س`;
  return `منذ ${Math.floor(h / 24)} يوم`;
}

function sevColor(s: number) {
  if (s >= 5) return "bg-red-600"; if (s >= 4) return "bg-orange-500";
  if (s >= 3) return "bg-amber-500"; if (s >= 2) return "bg-blue-500";
  return "bg-slate-400";
}

function sevGlow(s: number) {
  if (s >= 5) return "shadow-red-500/20"; if (s >= 4) return "shadow-orange-500/15";
  if (s >= 3) return "shadow-amber-500/10"; return "";
}

/**
 * Resilient authenticated fetch.
 * Refreshes the Supabase session before each call to prevent expired-token redirects.
 */
async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const apiUrl = withApiBase(url);
  // Force a refresh to ensure token is valid — prevents expired session issues
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    // Try refreshing the session first
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session?.access_token) {
      const headers: HeadersInit = {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${refreshed.session.access_token}`,
      };
      return fetch(apiUrl, { ...init, headers, credentials: "include" });
    }
  }
  const headers: HeadersInit = { ...(init?.headers ?? {}) };
  if (session?.access_token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${session.access_token}`;
  }
  return fetch(apiUrl, { ...init, headers, credentials: "include" });
}

// ── SeverityBar ────────────────────────────────────────────────────────────────

function SeverityBar({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-[3px]" title={`الخطورة: ${level}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`h-2 w-2 rounded-full transition-colors ${i < level
            ? (level >= 4 ? "bg-red-500" : level >= 3 ? "bg-amber-500" : "bg-blue-500")
            : "bg-slate-200 dark:bg-slate-700"
          }`} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CRISIS DETAIL PANEL — Institutional-grade action density
// ═══════════════════════════════════════════════════════════════════════════════

function CrisisDetailPanel({
  incident, onClose, onAnalyze, onExport, canAnalyze, isAnalyzing,
}: {
  incident: Incident; onClose: () => void;
  onAnalyze: (id: string) => void; onExport: (id: string) => void;
  canAnalyze: boolean; isAnalyzing: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const reportsQ = useQuery<IncidentReport[]>({
    queryKey: ["incident-reports", incident.id],
    queryFn: async () => {
      const r = await authedFetch(`/api/incidents/${incident.id}/reports?limit=100`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 15_000,
  });
  const reports = reportsQ.data ?? [];

  const [notesText, setNotesText] = useState(incident.analyst_notes ?? "");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  useEffect(() => {
    setNotesText(incident.analyst_notes ?? "");
    setIsEditingNotes(false);
  }, [incident.id, incident.analyst_notes]);

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    try {
      const res = await authedFetch(`/api/incidents/${incident.id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesText }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "تم حفظ الملاحظات" });
      setIsEditingNotes(false);
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    } catch (e: any) {
      toast({ title: "فشل حفظ الملاحظات", variant: "destructive" });
    } finally { setIsSavingNotes(false); }
  };

  return (
    <div className="h-full flex flex-col ops-detail-panel">
      {/* Header */}
      <div className="p-6 border-b border-slate-200 dark:border-slate-700/50">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl ${incident.status === "active"
                ? "bg-red-50 dark:bg-red-950/30 ring-1 ring-red-200 dark:ring-red-800/30"
                : "bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-800/30"
              }`}>
              {catIcon(incident.category)}
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">{incident.category}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{incident.area} • {incident.report_count} بلاغ</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full"><X className="w-4 h-4" /></Button>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <Badge className={`${incident.status === "active" ? "bg-red-600" : "bg-amber-500"} text-white text-[11px] px-3 py-1 font-semibold`}>
            {incident.status === "active" ? "⚠ أزمة نشطة" : "تحت المراقبة"}
          </Badge>
          <SeverityBar level={incident.severity} />
          <span className="text-xs text-muted-foreground font-medium">خطورة {incident.severity}/5</span>
          <span className="text-xs text-muted-foreground">• {timeAgo(incident.updated_at)}</span>
        </div>

        {/* ── ACTION BAR ── */}
        <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-slate-200 dark:border-slate-700/50" onClick={e => e.stopPropagation()}>
          <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg px-4 shadow-sm"
            onClick={() => onExport(incident.id)}>
            <Download className="w-3.5 h-3.5" /> تصدير Excel مؤسسي
          </Button>
          {canAnalyze && (
            <Button size="sm" variant="outline" className="gap-2 text-xs rounded-lg px-4 border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
              onClick={() => onAnalyze(incident.id)} disabled={isAnalyzing}>
              {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
              {incident.ai_summary ? "إعادة التقييم ↻" : "تحليل ذكي"}
            </Button>
          )}
        </div>
      </div>

      {/* Body tabs */}
      <Tabs defaultValue="justification" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-6 mt-4 bg-slate-100 dark:bg-slate-800/50 w-fit justify-start rounded-lg p-1">
          <TabsTrigger value="justification" className="text-xs gap-1.5 rounded-md data-[state=active]:shadow-sm"><Brain className="w-3 h-3" /> التبرير</TabsTrigger>
          <TabsTrigger value="reports" className="text-xs gap-1.5 rounded-md data-[state=active]:shadow-sm"><FileText className="w-3 h-3" /> البلاغات ({reports.length})</TabsTrigger>
          <TabsTrigger value="notes" className="text-xs gap-1.5 rounded-md data-[state=active]:shadow-sm"><Pencil className="w-3 h-3" /> ملاحظات</TabsTrigger>
        </TabsList>

        {/* AI JUSTIFICATION TAB */}
        <TabsContent value="justification" className="flex-1 overflow-auto">
          <ScrollArea className="h-full">
            <div className="p-6 space-y-4">
              {incident.ai_summary ? (
                <>
                  <div className="rounded-2xl p-5 bg-gradient-to-br from-blue-50 to-indigo-50/50 dark:from-blue-950/40 dark:to-indigo-950/20 border border-blue-100 dark:border-blue-800/30">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                        <Brain className="w-4 h-4 text-white" />
                      </div>
                      <span className="font-bold text-blue-900 dark:text-blue-200">التحليل الاستخباراتي</span>
                    </div>
                    <div className="text-sm leading-[2] whitespace-pre-line text-foreground/90">{incident.ai_summary}</div>
                  </div>

                  <div className="rounded-xl p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700/50">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      <span className="font-semibold text-sm">ملخص الأدلة</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="text-xs"><span className="text-muted-foreground">البلاغات:</span> <span className="font-semibold">{incident.report_count}</span></div>
                      <div className="text-xs"><span className="text-muted-foreground">المنطقة:</span> <span className="font-semibold">{incident.area}</span></div>
                      <div className="text-xs"><span className="text-muted-foreground">الفئة:</span> <span className="font-semibold">{incident.category}</span></div>
                      <div className="text-xs"><span className="text-muted-foreground">الخطورة:</span> <span className="font-semibold">{incident.severity}/5</span></div>
                    </div>
                  </div>

                  {canAnalyze && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <p className="text-[11px] text-blue-700 dark:text-blue-400">كل إعادة تقييم تُسجّل في سجل التدقيق المؤسسي.</p>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground italic">⚠️ تحليل استشاري آلي — القرار النهائي يعود للمشغل البشري</p>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                    <Bot className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">لم يتم التحليل بعد</p>
                  <p className="text-xs text-muted-foreground/70 mb-5">قم بتشغيل التحليل لتوليد التبرير والتقييم</p>
                  {canAnalyze && (
                    <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg" size="sm"
                      onClick={() => onAnalyze(incident.id)} disabled={isAnalyzing}>
                      <Brain className="w-3.5 h-3.5" /> تشغيل التحليل
                    </Button>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* LINKED REPORTS TAB */}
        <TabsContent value="reports" className="flex-1 overflow-auto">
          <ScrollArea className="h-full">
            <div className="p-6 space-y-2">
              {reportsQ.isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
              ) : reports.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">لا توجد بلاغات مرتبطة</p>
              ) : reports.map(r => (
                <div key={r.id} className="p-3.5 rounded-xl bg-white dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 space-y-1.5 hover:border-slate-200 dark:hover:border-slate-600 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span>{catIcon(r.category ?? "")}</span>
                      <span className="font-medium">{r.category ?? "—"}</span>
                      <span className="text-muted-foreground">• {r.area ?? "—"}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(r.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{r.content?.slice(0, 200) ?? r.title ?? "—"}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ANALYST NOTES TAB */}
        <TabsContent value="notes" className="flex-1 overflow-auto">
          <ScrollArea className="h-full">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold">ملاحظات المحلل</span>
                </div>
                {canAnalyze && !isEditingNotes && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setIsEditingNotes(true)}>
                    <Pencil className="w-3 h-3" /> تعديل
                  </Button>
                )}
              </div>

              {isEditingNotes ? (
                <div className="space-y-3">
                  <textarea className="w-full min-h-[120px] p-3 text-sm rounded-xl border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={notesText} onChange={e => setNotesText(e.target.value)}
                    placeholder="أضف ملاحظاتك هنا..." maxLength={2000} dir="rtl" />
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="gap-1.5 text-xs rounded-lg" onClick={handleSaveNotes} disabled={isSavingNotes}>
                      {isSavingNotes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} حفظ
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => { setNotesText(incident.analyst_notes ?? ""); setIsEditingNotes(false); }}>إلغاء</Button>
                    <span className="text-[10px] text-muted-foreground mr-auto">{notesText.length}/2000</span>
                  </div>
                </div>
              ) : notesText ? (
                <div className="p-4 rounded-xl bg-white dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                  <p className="text-sm leading-relaxed whitespace-pre-line">{notesText}</p>
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-xs text-muted-foreground">لا توجد ملاحظات بعد</p>
                  {canAnalyze && (
                    <Button variant="ghost" size="sm" className="text-xs mt-2" onClick={() => setIsEditingNotes(true)}>إضافة ملاحظة</Button>
                  )}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground italic">يتم تسجيل كل تعديل في سجل التدقيق.</p>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

export default function Dashboard() {
  const { user, org, logout, isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTimeoutWarn, setShowTimeoutWarn] = useState(false);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [rptCategoryFilter, setRptCategoryFilter] = useState<string>("all");
  const [rptAreaFilter, setRptAreaFilter] = useState<string>("all");
  const [intelData, setIntelData] = useState<IntelScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  // Guard: prevent redirect during active async operations (export/analyze)
  const busyRef = useRef(false);

  // ── Session timeout ──
  const IDLE_WARN = 28 * 60_000;
  const IDLE_OUT = 30 * 60_000;
  const wRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const oRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetIdle = useCallback(() => {
    if (wRef.current) clearTimeout(wRef.current);
    if (oRef.current) clearTimeout(oRef.current);
    setShowTimeoutWarn(false);
    wRef.current = setTimeout(() => setShowTimeoutWarn(true), IDLE_WARN);
    oRef.current = setTimeout(async () => {
      setShowTimeoutWarn(false);
      try { await logout(); } catch { }
      navigate("/login");
    }, IDLE_OUT);
  }, [logout, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const events = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"];
    const h = () => resetIdle();
    events.forEach(e => window.addEventListener(e, h, { passive: true }));
    resetIdle();
    return () => {
      events.forEach(e => window.removeEventListener(e, h));
      if (wRef.current) clearTimeout(wRef.current);
      if (oRef.current) clearTimeout(oRef.current);
    };
  }, [isAuthenticated, resetIdle]);

  // Redirect only when NOT busy with an operation
  useEffect(() => {
    if (!authLoading && !isAuthenticated && !busyRef.current) navigate("/login");
  }, [authLoading, isAuthenticated, navigate]);

  // ── Data queries ─────────────────────────────────────────────────────────

  const activeQ = useQuery<Incident[]>({
    queryKey: ["incidents", "active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("incidents").select("*").eq("status", "active").order("updated_at", { ascending: false });
      if (error) throw error; return (data ?? []) as Incident[];
    },
    enabled: isAuthenticated, staleTime: 30_000,
  });

  const monitorQ = useQuery<Incident[]>({
    queryKey: ["incidents", "monitoring"],
    queryFn: async () => {
      const { data, error } = await supabase.from("incidents").select("*").eq("status", "monitoring").order("updated_at", { ascending: false });
      if (error) throw error; return (data ?? []) as Incident[];
    },
    enabled: isAuthenticated, staleTime: 30_000,
  });

  const reportsQ = useQuery<IncidentReport[]>({
    queryKey: ["all-reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reports").select("id, title, content, category, area, status, created_at").order("created_at", { ascending: false }).limit(200);
      if (error) throw error; return (data ?? []) as IncidentReport[];
    },
    enabled: isAuthenticated, staleTime: 30_000,
  });

  const active = activeQ.data ?? [];
  const monitoring = monitorQ.data ?? [];
  const allIncidents = [...active, ...monitoring];
  const selectedIncident = allIncidents.find(i => i.id === selectedId) ?? null;
  const allReports = reportsQ.data ?? [];

  const filteredReports = allReports.filter(r => {
    if (rptCategoryFilter !== "all" && r.category !== rptCategoryFilter) return false;
    if (rptAreaFilter !== "all" && r.area !== rptAreaFilter) return false;
    return true;
  });

  const reportCategories = Array.from(new Set(allReports.map(r => r.category).filter(Boolean)));
  const reportAreas = Array.from(new Set(allReports.map(r => r.area).filter(Boolean)));
  const avgSeverity = allIncidents.length > 0
    ? (allIncidents.reduce((s, i) => s + i.severity, 0) / allIncidents.length).toFixed(1) : "—";

  const invalidateAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["incidents"] });
    await queryClient.invalidateQueries({ queryKey: ["all-reports"] });
  }, [queryClient]);

  useEffect(() => {
    const iv = setInterval(invalidateAll, 60_000);
    return () => clearInterval(iv);
  }, [invalidateAll]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleRefresh = async () => {
    if (isRefreshing) return; setIsRefreshing(true);
    try { await invalidateAll(); toast({ title: "تم تحديث البيانات" }); }
    catch { toast({ title: "فشل التحديث", variant: "destructive" }); }
    finally { setIsRefreshing(false); }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return; setIsLoggingOut(true);
    try { await logout(); navigate("/login"); }
    catch { toast({ title: "فشل تسجيل الخروج", variant: "destructive" }); }
    finally { setIsLoggingOut(false); }
  };

  const handleAnalyze = async (id: string) => {
    if (analyzingIds.has(id)) return;
    busyRef.current = true;
    setAnalyzingIds(prev => new Set(Array.from(prev).concat(id)));
    try {
      const res = await authedFetch(`/api/incidents/${id}/analyze`, { method: "POST" });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok || !body.success) {
        toast({ title: "فشل التحليل", description: body.error ?? body.message ?? "خطأ", variant: "destructive" });
      } else {
        toast({ title: "✅ تم التحليل بنجاح" });
        setTimeout(invalidateAll, 1500);
      }
    } catch (e: any) { toast({ title: "فشل التحليل", description: e.message, variant: "destructive" }); }
    finally {
      setAnalyzingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      busyRef.current = false;
    }
  };

  const handleExport = async (id: string) => {
    busyRef.current = true;
    try {
      const res = await authedFetch(`/api/incidents/${id}/export`);
      if (res.status === 401) { toast({ title: "انتهت الجلسة — أعد تسجيل الدخول", variant: "destructive" }); return; }
      if (res.status === 403) { toast({ title: "ليس لديك صلاحية التصدير", variant: "destructive" }); return; }
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") ?? "";
      const m = disp.match(/filename="([^"]+)"/);
      const fn = m?.[1] ?? `incident-${id.slice(0, 8)}.xlsx`;
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = u; a.download = fn;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
      toast({ title: "✅ تم تصدير الملف المؤسسي", description: fn });
    } catch (e: any) { toast({ title: "فشل التصدير", description: e.message, variant: "destructive" }); }
    finally { busyRef.current = false; }
  };

  const handleExportReports = () => {
    const csvRows = [["ID", "التاريخ", "الفئة", "المنطقة", "الحالة", "المحتوى"].join(",")];
    for (const r of filteredReports) {
      csvRows.push([r.id, r.created_at, r.category ?? "", r.area ?? "", r.status,
      `"${(r.content ?? r.title ?? "").replace(/"/g, '""').slice(0, 300)}"`].join(","));
    }
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = u;
    a.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
    toast({ title: "✅ تم تصدير البلاغات" });
  };

  const handleScanIntel = async () => {
    if (isScanning) return; setIsScanning(true);
    busyRef.current = true;
    try {
      const res = await authedFetch("/api/intelligence/scan");
      if (!res.ok) throw new Error(await res.text());
      const data: IntelScanResult = await res.json();
      setIntelData(data);
      toast({ title: `اكتمل الفحص`, description: `${data.suggestions.length} إشارة` });
    } catch (e: any) { toast({ title: "فشل الفحص", description: e.message, variant: "destructive" }); }
    finally { setIsScanning(false); busyRef.current = false; }
  };

  // ── Guard ──

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  if (!isAuthenticated) return null;

  const canAnalyze = user?.role === "admin" || user?.role === "analyst";
  const canExport = user?.role === "admin" || user?.role === "analyst";
  const roleLabels: Record<string, string> = { admin: "مدير النظام", analyst: "محلل", viewer: "مراقب" };
  const suggestions = intelData?.suggestions ?? [];

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col ops-dashboard" dir="rtl">
      {/* Session Timeout */}
      <Dialog open={showTimeoutWarn} onOpenChange={setShowTimeoutWarn}>
        <DialogContent className="sm:max-w-[420px]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600"><Clock className="w-5 h-5" /> تحذير: انتهاء الجلسة</DialogTitle>
            <DialogDescription>ستنتهي جلستك خلال دقيقتين بسبب عدم النشاط.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-row-reverse">
            <Button onClick={() => resetIdle()} className="bg-blue-600 hover:bg-blue-700 text-white">استمرار</Button>
            <Button variant="outline" onClick={handleLogout}>خروج</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── HEADER ── */}
      <header className="sticky top-0 z-50 ops-header text-white">
        <div className="max-w-[1920px] mx-auto px-6 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-sm font-bold tracking-tight">منصة استخبارات الأزمات</h1>
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-300 font-mono border border-blue-500/20">v1.0</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">{org?.name ? `${org.name} — ` : ""}{user?.displayName ?? user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold px-3 py-1 rounded-full bg-slate-700/80 text-slate-300 border border-slate-600/50">
              {roleLabels[user?.role ?? ""] ?? user?.role}
            </span>
            {canExport && (
              <Button variant="ghost" size="sm" onClick={handleExportReports} className="text-slate-400 hover:text-white hover:bg-white/10 h-8 text-[11px] gap-1.5 rounded-lg">
                <Download className="w-3.5 h-3.5" /> تصدير شامل
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="text-slate-400 hover:text-white hover:bg-white/10 h-8 text-[11px] gap-1.5 rounded-lg">
              {isRefreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} تحديث
            </Button>
            <div className="w-px h-5 bg-slate-700 mx-1" />
            <Button variant="ghost" size="sm" onClick={handleLogout} disabled={isLoggingOut} className="text-slate-400 hover:text-white hover:bg-white/10 h-8 text-[11px] gap-1.5 rounded-lg">
              {isLoggingOut ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ═══ LEFT: Main content ═══ */}
        <div className={`${selectedIncident ? "w-[440px] xl:w-[500px] shrink-0" : "flex-1"} flex flex-col border-l border-slate-200 dark:border-slate-800 overflow-hidden transition-all duration-300`}>

          {/* Stats */}
          <div className="px-6 pt-5 pb-4 grid grid-cols-4 gap-4">
            {[
              { icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30", val: active.length, label: "أزمات نشطة" },
              { icon: Eye, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", val: monitoring.length, label: "تحت المراقبة" },
              { icon: BarChart3, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30", val: allReports.length, label: "إجمالي البلاغات" },
              { icon: Activity, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30", val: avgSeverity, label: "متوسط الخطورة" },
            ].map((s, i) => (
              <div key={i} className="ops-stat flex items-center gap-3 p-3.5 rounded-xl">
                <div className={`p-2.5 rounded-xl ${s.bg}`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
                <div>
                  <p className="text-xl font-extrabold leading-none tracking-tight">{s.val}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 font-medium">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Main tabs */}
          <Tabs defaultValue="crises" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-6 bg-white dark:bg-slate-800/60 shadow-sm border border-slate-200 dark:border-slate-700/50 w-fit justify-start rounded-lg p-1">
              <TabsTrigger value="crises" className="text-xs gap-1.5 font-semibold rounded-md data-[state=active]:shadow-sm"><Layers className="w-3.5 h-3.5" /> الأزمات ({allIncidents.length})</TabsTrigger>
              <TabsTrigger value="reports" className="text-xs gap-1.5 font-semibold rounded-md data-[state=active]:shadow-sm"><FileText className="w-3.5 h-3.5" /> البلاغات ({allReports.length})</TabsTrigger>
              {canAnalyze && (
                <TabsTrigger value="signals" className="text-xs gap-1.5 font-medium rounded-md text-slate-400 data-[state=active]:text-slate-600 data-[state=active]:shadow-sm"><Eye className="w-3.5 h-3.5" /> إشارات استشارية</TabsTrigger>
              )}
            </TabsList>

            {/* ── CRISES TAB ── */}
            <TabsContent value="crises" className="flex-1 overflow-auto">
              <ScrollArea className="h-full">
                <div className="p-6 space-y-6">
                  {activeQ.isLoading ? (
                    <div className="space-y-4">{[1, 2].map(i => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
                  ) : active.length > 0 ? (
                    <section>
                      <div className="flex items-center gap-2.5 mb-4">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 pulse-dot" />
                        <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">أزمات نشطة — تتطلب اتخاذ إجراء</span>
                      </div>
                      <div className={selectedIncident ? "space-y-3" : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"}>
                        {active.map(inc => (
                          <div key={inc.id} onClick={() => setSelectedId(inc.id)}
                            className={`ops-card relative cursor-pointer rounded-2xl overflow-hidden ${inc.id === selectedId ? "ring-2 ring-blue-500 shadow-lg" : ""
                              } ${sevGlow(inc.severity)} shadow-md`}>
                            <div className={`absolute top-0 left-0 right-0 h-1 ${sevColor(inc.severity)}`} />
                            <div className="p-5 pt-4 space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-3">
                                  <span className="text-2xl">{catIcon(inc.category)}</span>
                                  <div>
                                    <p className="font-bold text-sm">{inc.category}</p>
                                    <p className="text-[11px] text-muted-foreground">{inc.area}</p>
                                  </div>
                                </div>
                                <div className="text-left">
                                  <Badge className="bg-red-600 text-white text-[10px] font-semibold px-2">نشط</Badge>
                                  <p className="text-[9px] text-muted-foreground mt-1">{timeAgo(inc.updated_at)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-bold">{inc.report_count} بلاغ</span>
                                <SeverityBar level={inc.severity} />
                              </div>
                              {inc.ai_summary && (
                                <div className="p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                                  {inc.ai_summary}
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 pt-1" onClick={e => e.stopPropagation()}>
                                {canExport && (
                                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1.5 rounded-lg" onClick={() => handleExport(inc.id)}>
                                    <Download className="w-3 h-3" /> تصدير
                                  </Button>
                                )}
                                {canAnalyze && !inc.ai_summary && (
                                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1.5 text-blue-600 rounded-lg" onClick={() => handleAnalyze(inc.id)} disabled={analyzingIds.has(inc.id)}>
                                    {analyzingIds.has(inc.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />} تحليل
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : (
                    <div className="ops-card rounded-2xl p-10 text-center">
                      <Shield className="w-12 h-12 text-emerald-500/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">لا توجد أزمات نشطة — الوضع مستقر</p>
                    </div>
                  )}

                  {monitoring.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2.5 mb-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">تحت المراقبة</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mb-3">حوادث لم تصل لحد الأزمة بعد — مرتبطة ببلاغات لم تتجاوز عتبة التصعيد.</p>
                      <div className={selectedIncident ? "space-y-2" : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"}>
                        {monitoring.map(inc => (
                          <div key={inc.id} onClick={() => setSelectedId(inc.id)}
                            className={`ops-card cursor-pointer rounded-xl p-3.5 flex items-center gap-3 ${inc.id === selectedId ? "ring-2 ring-blue-500" : ""}`}>
                            <span className="text-lg">{catIcon(inc.category)}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate">{inc.category} — {inc.area}</p>
                              <p className="text-[10px] text-muted-foreground">{inc.report_count} بلاغ • {timeAgo(inc.updated_at)}</p>
                            </div>
                            <SeverityBar level={inc.severity} />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── REPORTS TAB ── */}
            <TabsContent value="reports" className="flex-1 overflow-auto">
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <FilterIcon className="w-3.5 h-3.5" /> تصفية:
                  </div>
                  <Select value={rptCategoryFilter} onValueChange={setRptCategoryFilter}>
                    <SelectTrigger className="h-8 w-[160px] text-xs rounded-lg"><SelectValue placeholder="الفئة" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">جميع الفئات</SelectItem>
                      {reportCategories.map(c => <SelectItem key={c as string} value={c as string}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={rptAreaFilter} onValueChange={setRptAreaFilter}>
                    <SelectTrigger className="h-8 w-[160px] text-xs rounded-lg"><SelectValue placeholder="المنطقة" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">جميع المناطق</SelectItem>
                      {reportAreas.map(a => <SelectItem key={a as string} value={a as string}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {(rptCategoryFilter !== "all" || rptAreaFilter !== "all") && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground" onClick={() => { setRptCategoryFilter("all"); setRptAreaFilter("all"); }}>
                      <X className="w-3 h-3" /> مسح
                    </Button>
                  )}
                  <div className="flex-1" />
                  <span className="text-xs text-muted-foreground font-medium">{filteredReports.length} بلاغ</span>
                  {canExport && (
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 rounded-lg" onClick={handleExportReports}>
                      <Download className="w-3.5 h-3.5" /> CSV
                    </Button>
                  )}
                </div>
                <Separator />
                <ScrollArea className="h-[calc(100vh-300px)]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-100/90 dark:bg-slate-800/90 backdrop-blur z-10">
                      <tr className="border-b">
                        <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">التاريخ</th>
                        <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">الفئة</th>
                        <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">المنطقة</th>
                        <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">الحالة</th>
                        <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">المحتوى</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportsQ.isLoading ? (
                        <tr><td colSpan={5} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
                      ) : filteredReports.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">لا توجد بلاغات</td></tr>
                      ) : filteredReports.map(r => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-white/60 dark:hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{timeAgo(r.created_at)}</td>
                          <td className="py-2.5 px-3"><span className="flex items-center gap-1.5">{catIcon(r.category ?? "")} {r.category ?? "—"}</span></td>
                          <td className="py-2.5 px-3">{r.area ?? "—"}</td>
                          <td className="py-2.5 px-3"><Badge variant="secondary" className="text-[10px]">{r.status}</Badge></td>
                          <td className="py-2.5 px-3 max-w-[300px] truncate text-muted-foreground">{r.content?.slice(0, 120) ?? r.title ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </div>
            </TabsContent>

            {/* ── SIGNALS TAB — Advisory-only ── */}
            {canAnalyze && (
              <TabsContent value="signals" className="flex-1 overflow-auto">
                <ScrollArea className="h-full">
                  <div className="p-6 space-y-3">
                    <div className="p-4 rounded-xl bg-slate-100/80 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/30">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Eye className="w-4 h-4 text-slate-400" />
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">إشارات استشارية — للإطلاع فقط</span>
                        <Badge variant="secondary" className="text-[9px] px-1.5">استشاري</Badge>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        مؤشرات آلية. ليست أزمات. لا تحمل سلطة قرار. القرار يعود للمحلل البشري.
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">
                        {intelData ? `${intelData.reports_scanned} بلاغ • ${intelData.scan_duration_ms}ms` : ""}
                      </span>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 border-slate-300 text-slate-500 rounded-lg" onClick={handleScanIntel} disabled={isScanning}>
                        {isScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />} فحص
                      </Button>
                    </div>

                    <Separator />

                    {!intelData ? (
                      <div className="py-14 text-center">
                        <Eye className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                        <p className="text-xs text-slate-400">اضغط "فحص" لتحليل الأنماط</p>
                      </div>
                    ) : suggestions.length === 0 ? (
                      <div className="ops-card rounded-xl p-6 text-center">
                        <p className="text-xs text-slate-400">لم يتم اكتشاف أنماط — {intelData.reports_scanned} بلاغ</p>
                      </div>
                    ) : suggestions.map(s => {
                      const typeLabel = s.type === "cross_category_link" ? "رابط سببي" : s.type === "temporal_cluster" ? "تجمع زمني" : s.type === "escalation_risk" ? "خطر تصعيد" : "إشارة ضعيفة";
                      const confIcon = s.confidence_level === "عالية" ? "🟢" : s.confidence_level === "متوسطة" ? "🟡" : "🔴";
                      return (
                        <div key={s.id} className="signal-card p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/30 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{s.title}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="secondary" className="text-[10px] px-1.5">{typeLabel}</Badge>
                                <span className="text-[10px] text-slate-400">{s.area}</span>
                              </div>
                            </div>
                            <span className="text-xs text-slate-400">{confIcon} {s.confidence}%</span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">{s.description}</p>
                          <details className="text-[11px]">
                            <summary className="cursor-pointer text-slate-400 hover:text-slate-500">الاستدلال</summary>
                            <div className="mt-2 p-2.5 rounded-lg bg-slate-100/80 dark:bg-slate-800/50 space-y-1.5">
                              <p className="text-slate-500"><strong>السبب:</strong> {s.reasoning}</p>
                              <p className="text-slate-400">{s.report_ids.length} بلاغ • {s.categories_involved.join("، ")}</p>
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* ═══ RIGHT: Crisis detail panel ═══ */}
        {selectedIncident && (
          <div className="flex-1 border-l border-slate-200 dark:border-slate-800 overflow-auto">
            <CrisisDetailPanel
              incident={selectedIncident}
              onClose={() => setSelectedId(null)}
              onAnalyze={handleAnalyze}
              onExport={handleExport}
              canAnalyze={canAnalyze}
              isAnalyzing={analyzingIds.has(selectedIncident.id)}
            />
          </div>
        )}
      </div>
    </div>
  );
}


