import { randomUUID } from "crypto";
import type {
  Report, InsertReport, Crisis, Signal, Stats, AIAnalysis,
  Organization, User, SafeUser, AnalysisRecord, AuditEntry,
} from "@shared/schema";
import { generateAnalysis } from "./services/aiService";

export interface IStorage {
  getReports(filters?: { limit?: number; region?: string; category?: string; severity?: number; q?: string; offset?: number }): Promise<{ reports: Report[]; total: number }>;
  getReport(id: string): Promise<Report | undefined>;
  createReport(data: InsertReport): Promise<Report>;
  getReportStats(): Promise<Stats>;
  getCrises(filters?: { status?: string; limit?: number }): Promise<Crisis[]>;
  getCrisis(id: string): Promise<Crisis | undefined>;
  getCrisisReports(crisisId: string, limit?: number): Promise<Report[]>;
  getSignals(): Promise<Signal[]>;
  generateCrisisAnalysis(crisisId: string): Promise<AIAnalysis>;

  getOrganizations(): Promise<Organization[]>;
  getOrganization(id: string): Promise<Organization | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUser(id: string): Promise<User | undefined>;

  saveAnalysisRecord(crisisId: string, analysis: AIAnalysis, userId: string, userName: string): Promise<AnalysisRecord>;
  getAnalysisRecords(crisisId: string): Promise<AnalysisRecord[]>;
  getAnalysisRecord(id: string): Promise<AnalysisRecord | undefined>;
  updateAnalysisStatus(id: string, status: "approved" | "rejected", reviewedBy: string, reviewerName: string, note: string): Promise<AnalysisRecord | undefined>;

  addAuditEntry(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry>;
  getAuditLog(limit?: number): Promise<AuditEntry[]>;
}

export class MemStorage implements IStorage {
  private reports: Map<string, Report>;
  private crises: Map<string, Crisis>;
  private signals: Map<string, Signal>;
  private organizations: Map<string, Organization>;
  private users: Map<string, User>;
  private analysisRecords: Map<string, AnalysisRecord>;
  private auditLog: AuditEntry[];

  constructor() {
    this.reports = new Map();
    this.crises = new Map();
    this.signals = new Map();
    this.organizations = new Map();
    this.users = new Map();
    this.analysisRecords = new Map();
    this.auditLog = [];
    this.seedData();
  }

  private seedData() {
    const now = new Date();

    const orgs: Organization[] = [
      { id: "org-unrwa", name: "UNRWA", nameAr: "الأونروا", type: "un" },
      { id: "org-who", name: "WHO", nameAr: "منظمة الصحة العالمية", type: "un" },
      { id: "org-unicef", name: "UNICEF", nameAr: "اليونيسف", type: "un" },
      { id: "org-icrc", name: "ICRC", nameAr: "اللجنة الدولية للصليب الأحمر", type: "ingo" },
      { id: "org-wfp", name: "WFP", nameAr: "برنامج الأغذية العالمي", type: "un" },
    ];
    for (const o of orgs) this.organizations.set(o.id, o);

    const users: User[] = [
      { id: "user-1", username: "admin", password: "admin123", displayName: "مدير النظام", orgId: "org-unrwa", role: "admin" },
      { id: "user-2", username: "analyst", password: "analyst123", displayName: "محلل بيانات", orgId: "org-unrwa", role: "analyst" },
      { id: "user-3", username: "who_admin", password: "who123", displayName: "مسؤول الصحة", orgId: "org-who", role: "admin" },
      { id: "user-4", username: "unicef_admin", password: "unicef123", displayName: "مسؤول حماية الطفل", orgId: "org-unicef", role: "admin" },
      { id: "user-5", username: "icrc_analyst", password: "icrc123", displayName: "محلل ميداني", orgId: "org-icrc", role: "analyst" },
      { id: "user-6", username: "wfp_viewer", password: "wfp123", displayName: "مراقب التغذية", orgId: "org-wfp", role: "viewer" },
    ];
    for (const u of users) this.users.set(u.id, u);

    const reports: Report[] = [
      {
        id: randomUUID(), category: "صحة", subProblem: "نقص الأدوية الأساسية (مسكنات، مضادات حيوية)",
        area: "شمال غزة", specificLocation: "جباليا",
        details: "لا تتوفر أدوية مسكنة للألم منذ أسبوعين. الأطفال يعانون من حمى شديدة بدون علاج.",
        fullName: "", idNumber: "", phone: "", severityLevel: 5, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "مياه وصرف صحي", subProblem: "عدم توفر مياه صالحة للشرب بشكل منتظم",
        area: "غزة المدينة", specificLocation: "الشجاعية",
        details: "انقطاع المياه منذ 5 أيام. نضطر لشرب مياه غير نظيفة.",
        fullName: "", idNumber: "", phone: "", severityLevel: 5, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "غذاء وتغذية", subProblem: "عدم توفر وجبات غذائية كافية",
        area: "الوسطى", specificLocation: "دير البلح",
        details: "عائلة من 8 أفراد لم تحصل على أي مساعدة غذائية منذ 10 أيام.",
        fullName: "", idNumber: "", phone: "", severityLevel: 4, status: "in_progress", assignedTo: "WFP",
        createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "مأوى وخيم", subProblem: "تلف الخيمة بسبب الأمطار أو الرياح",
        area: "خانيونس و رفح", specificLocation: "المواصي",
        details: "الخيمة تمزقت بالكامل بسبب العاصفة. عائلة من 6 أفراد بدون مأوى.",
        fullName: "", idNumber: "", phone: "", severityLevel: 5, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "صحة", subProblem: "انتشار أعراض إسهال وتقيؤ بين الأطفال",
        area: "شمال غزة", specificLocation: "بيت حانون",
        details: "أكثر من 15 طفل في المخيم يعانون من إسهال شديد وجفاف.",
        fullName: "", idNumber: "", phone: "", severityLevel: 5, status: "in_progress", assignedTo: "WHO",
        createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "الشتاء والتدفئة", subProblem: "عدم توفر ملابس شتوية كافية",
        area: "الوسطى", specificLocation: "النصيرات",
        details: "أطفال بلا ملابس شتوية والحرارة تنخفض ليلاً بشكل كبير.",
        fullName: "", idNumber: "", phone: "", severityLevel: 4, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "الوصول للخدمات الطبية", subProblem: "صعوبة الوصول للمستشفى بسبب الطرق او الطقس",
        area: "شمال غزة", specificLocation: "مخيم جباليا",
        details: "مريض يحتاج غسيل كلى ولا يستطيع الوصول لأقرب مستشفى.",
        fullName: "", idNumber: "", phone: "", severityLevel: 5, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "مياه وصرف صحي", subProblem: "تجمع مياه عادمة قرب أماكن السكن",
        area: "غزة المدينة", specificLocation: "الزيتون",
        details: "مياه الصرف الصحي تغمر المنطقة المحيطة بالخيام. رائحة كريهة وخطر صحي.",
        fullName: "", idNumber: "", phone: "", severityLevel: 4, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "غذاء وتغذية", subProblem: "سوء تغذية الأطفال والحوامل",
        area: "خانيونس و رفح", specificLocation: "بني سهيلا",
        details: "طفلان يعانيان من سوء تغذية حاد. الأم حامل وتحتاج دعم غذائي عاجل.",
        fullName: "", idNumber: "", phone: "", severityLevel: 5, status: "in_progress", assignedTo: "UNICEF",
        createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "صحة", subProblem: "التهابات تنفسية بسبب البرد والرطوبة",
        area: "الوسطى", specificLocation: "المغازي",
        details: "عدة حالات التهاب رئوي بين كبار السن في المخيم.",
        fullName: "", idNumber: "", phone: "", severityLevel: 3, status: "resolved", assignedTo: "WHO",
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "مأوى وخيم", subProblem: "تسرّب المياه داخل الخيمة",
        area: "شمال غزة", specificLocation: "بيت لاهيا",
        details: "مياه الأمطار تتسرب من كل مكان. الأغطية والفرش مبللة بالكامل.",
        fullName: "", idNumber: "", phone: "", severityLevel: 3, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "الوصول للخدمات الطبية", subProblem: "نقص سيارات الإسعاف",
        area: "غزة المدينة", specificLocation: "الرمال",
        details: "حالة ولادة طارئة ولا توجد سيارة إسعاف متاحة.",
        fullName: "", idNumber: "", phone: "", severityLevel: 5, status: "in_progress", assignedTo: "ICRC",
        createdAt: new Date(now.getTime() - 45 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "مياه وصرف صحي", subProblem: "نقص مواد النظافة",
        area: "خانيونس و رفح", specificLocation: "رفح الغربية",
        details: "لا يتوفر صابون أو مطهرات منذ أسابيع. انتشار الأمراض الجلدية.",
        fullName: "", idNumber: "", phone: "", severityLevel: 3, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "غذاء وتغذية", subProblem: "نقص حليب الأطفال",
        area: "شمال غزة", specificLocation: "جباليا",
        details: "رضيع عمره 3 أشهر بحاجة ماسة لحليب أطفال. الأم غير قادرة على الرضاعة.",
        fullName: "", idNumber: "", phone: "", severityLevel: 4, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString()
      },
      {
        id: randomUUID(), category: "الشتاء والتدفئة", subProblem: "التعرض للبرد الشديد خاصة للأطفال",
        area: "غزة المدينة", specificLocation: "الشيخ رضوان",
        details: "عائلة تضم 4 أطفال دون سن الخامسة بلا أغطية أو وسائل تدفئة.",
        fullName: "", idNumber: "", phone: "", severityLevel: 4, status: "pending", assignedTo: "",
        createdAt: new Date(now.getTime() - 14 * 60 * 60 * 1000).toISOString()
      }
    ];
    for (const r of reports) this.reports.set(r.id, r);

    const crises: Crisis[] = [
      {
        id: "crisis-1", title: "أزمة صحية حادة - شمال غزة",
        description: "تصاعد حاد في البلاغات الصحية المتعلقة بنقص الأدوية وانتشار الأوبئة في مناطق شمال غزة، مع عجز واضح في الكوادر الطبية.",
        area: "شمال غزة", category: "صحة", severity: "critical", status: "active",
        reportCount: 47,
        createdAt: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "crisis-2", title: "أزمة مياه وصرف صحي - غزة المدينة",
        description: "انقطاع شبه كامل لإمدادات المياه النظيفة مع تلوث واسع النطاق بسبب اختلاط مياه الصرف.",
        area: "غزة المدينة", category: "مياه وصرف صحي", severity: "critical", status: "active",
        reportCount: 35,
        createdAt: new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "crisis-3", title: "نقص غذائي حاد - الوسطى",
        description: "تزايد حالات سوء التغذية خاصة بين الأطفال والحوامل مع عدم كفاية المساعدات الغذائية.",
        area: "الوسطى", category: "غذاء وتغذية", severity: "high", status: "active",
        reportCount: 28,
        createdAt: new Date(now.getTime() - 96 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString()
      }
    ];
    for (const c of crises) this.crises.set(c.id, c);

    const signals: Signal[] = [
      { id: "sig-1", title: "ارتفاع بلاغات الإسهال بين الأطفال", description: "زيادة ملحوظة في بلاغات الإسهال والتقيؤ بين الأطفال في شمال غزة خلال الـ 48 ساعة الماضية.", area: "شمال غزة", category: "صحة", trend: "rising", reportCount: 12, lastUpdated: new Date(now.getTime() - 30 * 60 * 1000).toISOString() },
      { id: "sig-2", title: "تدهور جودة المياه - الزيتون", description: "تقارير متزايدة عن تلوث المياه في حي الزيتون مع ظهور حالات تسمم.", area: "غزة المدينة", category: "مياه وصرف صحي", trend: "rising", reportCount: 8, lastUpdated: new Date(now.getTime() - 60 * 60 * 1000).toISOString() },
      { id: "sig-3", title: "موجة برد قادمة - تحذير مبكر", description: "توقعات بانخفاض حاد في درجات الحرارة خلال الأيام القادمة مع عدم جاهزية المخيمات.", area: "الوسطى", category: "الشتاء والتدفئة", trend: "rising", reportCount: 6, lastUpdated: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString() },
      { id: "sig-4", title: "استقرار إمدادات الغذاء - خانيونس", description: "تحسن نسبي في توزيع المساعدات الغذائية بعد وصول شحنة جديدة.", area: "خانيونس و رفح", category: "غذاء وتغذية", trend: "stable", reportCount: 4, lastUpdated: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString() },
      { id: "sig-5", title: "تراجع بلاغات المأوى - دير البلح", description: "انخفاض في بلاغات المأوى بعد توزيع خيام جديدة من UNRWA.", area: "الوسطى", category: "مأوى وخيم", trend: "declining", reportCount: 3, lastUpdated: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString() },
    ];
    for (const s of signals) this.signals.set(s.id, s);
  }

  async getReports(filters?: { limit?: number; region?: string; category?: string; severity?: number; q?: string; offset?: number }): Promise<{ reports: Report[]; total: number }> {
    let results = Array.from(this.reports.values());
    if (filters?.region) results = results.filter(r => r.area === filters.region);
    if (filters?.category) results = results.filter(r => r.category === filters.category);
    if (filters?.severity) results = results.filter(r => r.severityLevel >= filters.severity!);
    if (filters?.q) {
      const q = filters.q.toLowerCase();
      results = results.filter(r => r.subProblem.toLowerCase().includes(q) || r.details.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
    }
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = results.length;
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    results = results.slice(offset, offset + limit);
    return { reports: results, total };
  }

  async getReport(id: string): Promise<Report | undefined> { return this.reports.get(id); }

  async createReport(data: InsertReport): Promise<Report> {
    const id = randomUUID();
    const report: Report = {
      id, category: data.category, subProblem: data.subProblem, area: data.area,
      specificLocation: data.specificLocation?.trim() || null, details: data.details || "",
      fullName: data.fullName || "", idNumber: data.idNumber || "", phone: data.phone || "",
      severityLevel: 3, status: "pending", assignedTo: "", createdAt: new Date().toISOString()
    };
    this.reports.set(id, report);
    return report;
  }

  async getReportStats(): Promise<Stats> {
    const reports = Array.from(this.reports.values());
    const totalReports = reports.length;
    const criticalCases = reports.filter(r => r.severityLevel >= 4).length;
    const pendingCases = reports.filter(r => r.status === "pending").length;
    const resolvedCases = reports.filter(r => r.status === "resolved").length;
    const areaCounts: Record<string, number> = {};
    reports.forEach(r => { areaCounts[r.area] = (areaCounts[r.area] || 0) + 1; });
    const topArea = Object.entries(areaCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const avgSeverity = totalReports > 0 ? parseFloat((reports.reduce((sum, r) => sum + r.severityLevel, 0) / totalReports).toFixed(1)) : 0;
    return { totalReports, criticalCases, pendingCases, topArea, avgSeverity, resolvedCases };
  }

  async getCrises(filters?: { status?: string; limit?: number }): Promise<Crisis[]> {
    let results = Array.from(this.crises.values());
    if (filters?.status) results = results.filter(c => c.status === filters.status);
    results.sort((a, b) => {
      const o: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (o[a.severity] ?? 3) - (o[b.severity] ?? 3);
    });
    if (filters?.limit) results = results.slice(0, filters.limit);
    return results;
  }

  async getCrisis(id: string): Promise<Crisis | undefined> { return this.crises.get(id); }

  async getCrisisReports(crisisId: string, limit = 5): Promise<Report[]> {
    const crisis = this.crises.get(crisisId);
    if (!crisis) return [];
    return Array.from(this.reports.values())
      .filter(r => r.category === crisis.category && r.area === crisis.area)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async getSignals(): Promise<Signal[]> {
    return Array.from(this.signals.values()).sort((a, b) => {
      const o: Record<string, number> = { rising: 0, stable: 1, declining: 2 };
      return (o[a.trend] ?? 1) - (o[b.trend] ?? 1);
    });
  }

  async generateCrisisAnalysis(crisisId: string): Promise<AIAnalysis> {
    const crisis = this.crises.get(crisisId);
    if (!crisis) throw new Error("Crisis not found");
    const sampleReports = await this.getCrisisReports(crisisId, 5);
    const stats = await this.getReportStats();
    return generateAnalysis(crisis, sampleReports, stats);
  }

  async getOrganizations(): Promise<Organization[]> { return Array.from(this.organizations.values()); }
  async getOrganization(id: string): Promise<Organization | undefined> { return this.organizations.get(id); }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.username === username);
  }

  async getUser(id: string): Promise<User | undefined> { return this.users.get(id); }

  async saveAnalysisRecord(crisisId: string, analysis: AIAnalysis, userId: string, userName: string): Promise<AnalysisRecord> {
    const id = randomUUID();
    const record: AnalysisRecord = {
      id, crisisId, analysis, status: "pending",
      generatedAt: new Date().toISOString(),
      reviewedBy: "", reviewerName: "", reviewerNote: "", reviewedAt: "",
    };
    this.analysisRecords.set(id, record);
    return record;
  }

  async getAnalysisRecords(crisisId: string): Promise<AnalysisRecord[]> {
    return Array.from(this.analysisRecords.values())
      .filter(r => r.crisisId === crisisId)
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  }

  async getAnalysisRecord(id: string): Promise<AnalysisRecord | undefined> {
    return this.analysisRecords.get(id);
  }

  async updateAnalysisStatus(id: string, status: "approved" | "rejected", reviewedBy: string, reviewerName: string, note: string): Promise<AnalysisRecord | undefined> {
    const record = this.analysisRecords.get(id);
    if (!record) return undefined;
    record.status = status;
    record.reviewedBy = reviewedBy;
    record.reviewerName = reviewerName;
    record.reviewerNote = note;
    record.reviewedAt = new Date().toISOString();
    return record;
  }

  async addAuditEntry(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    const full: AuditEntry = { ...entry, id: randomUUID(), timestamp: new Date().toISOString() };
    this.auditLog.unshift(full);
    if (this.auditLog.length > 500) this.auditLog = this.auditLog.slice(0, 500);
    return full;
  }

  async getAuditLog(limit = 50): Promise<AuditEntry[]> {
    return this.auditLog.slice(0, limit);
  }
}

export const storage = new MemStorage();
