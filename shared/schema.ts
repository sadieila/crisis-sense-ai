import { z } from "zod";

export const categories: Record<string, { icon: string; problems: string[] }> = {
  "صحة": {
    icon: "HeartPulse",
    problems: [
      "نقص الأدوية الأساسية (مسكنات، مضادات حيوية)",
      "انقطاع علاج الأمراض المزمنة (سكر، ضغط، ربو)",
      "إصابات تحتاج رعاية أولية ولا يوجد طبيب",
      "انتشار أعراض إسهال وتقيؤ بين الأطفال",
      "التهابات تنفسية بسبب البرد والرطوبة",
      "أمراض جلدية بسبب سوء النظافة والازدحام",
      "أخرى (مشكلة صحية غير مذكورة)"
    ]
  },
  "مياه وصرف صحي": {
    icon: "Droplets",
    problems: [
      "عدم توفر مياه صالحة للشرب بشكل منتظم",
      "مياه ملوثة أو غير صالحة للاستخدام",
      "اختلاط مياه الصرف مع مياه الأمطار",
      "تجمع مياه عادمة قرب أماكن السكن",
      "عدم توفر مراحيض كافية أو صالحة",
      "نقص مواد النظافة",
      "أخرى (مشكلة مياه أو صرف صحي)"
    ]
  },
  "غذاء وتغذية": {
    icon: "UtensilsCrossed",
    problems: [
      "عدم توفر وجبات غذائية كافية",
      "سوء تغذية الأطفال والحوامل",
      "نقص حليب الأطفال",
      "عدم توفر أدوات طبخ",
      "عدم توفر نقاط لتوزيع او بيع الخبز",
      "أخرى (مشكلة غذائية أو تغذية)"
    ]
  },
  "مأوى وخيم": {
    icon: "Home",
    problems: [
      "تلف الخيمة بسبب الأمطار أو الرياح",
      "تسرّب المياه داخل الخيمة",
      "عدم توفر أغطية أو فرش",
      "عدم عزل الخيمة عن البرد",
      "اكتظاظ شديد داخل الخيام",
      "موقع الخيمة غير آمن أو معرض للغرق",
      "أخرى (مشكلة مأوى أو خيم)"
    ]
  },
  "الشتاء والتدفئة": {
    icon: "Thermometer",
    problems: [
      "عدم توفر ملابس شتوية كافية",
      "التعرض للبرد الشديد خاصة للأطفال",
      "أمراض ناتجة عن البرد والرطوبة",
      "الحاجة لمستلزمات شتوية (أغطية، مدافئ)",
      "أخرى (مشكلة متعلقة بالشتاء أو التدفئة)"
    ]
  },
  "الوصول للخدمات الطبية": {
    icon: "Ambulance",
    problems: [
      "إغلاق أو توقف مركز صحي قريب",
      "صعوبة الوصول للمستشفى بسبب الطرق او الطقس",
      "نقص سيارات الإسعاف",
      "تأخر الاستجابة للحالات الطارئة",
      "عدم توفر طواقم طبية كافية",
      "عدم توفر نقاط طبية و إسعاف أولي",
      "أخرى (مشكلة في الوصول للخدمات الطبية)"
    ]
  },
  "لا أعرف / أخرى": {
    icon: "CircleHelp",
    problems: [
      "عدة مشاكل في نفس الوقت",
      "لا أستطيع تحديد المشكلة"
    ]
  }
};

export const areas = ["شمال غزة", "غزة المدينة", "الوسطى", "خانيونس و رفح"];

export const subAreas: Record<string, string[]> = {
  "شمال غزة": ["جباليا", "بيت حانون", "بيت لاهيا", "مخيم جباليا"],
  "غزة المدينة": ["غزة المدينة", "الشجاعية", "الزيتون", "الرمال", "التفاح", "الشيخ رضوان"],
  "الوسطى": ["دير البلح", "النصيرات", "المغازي", "البريج"],
  "خانيونس و رفح": ["المواصي", "بني سهيلا", "القرارة", "خزاعة", "رفح الغربية", "رفح الشرقية", "تل السلطان"]
};

export interface Report {
  id: string;
  category: string;
  subProblem: string;
  area: string;
  specificLocation: string | null | undefined;
  details: string;
  fullName: string;
  idNumber: string;
  phone: string;
  severityLevel: number;
  status: "pending" | "in_progress" | "resolved";
  assignedTo: string;
  createdAt: string;
}

export interface Incident {
  id: string;
  category: string;
  area: string;
  status: "monitoring" | "active" | "resolved";
  severity: number;
  report_count: number;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentReport {
  incident_id: string;
  report_id: string;
  linked_at: string;
}

export const insertReportSchema = z.object({
  category: z.string().min(1),
  subProblem: z.string().min(1),
  area: z.string().min(1),
  specificLocation: z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().trim().min(1).nullable().optional(),
  ),
  details: z.string().optional().default(""),
  fullName: z.string().optional().default(""),
  idNumber: z.string().optional().default(""),
  phone: z.string().optional().default(""),
});

export type InsertReport = z.infer<typeof insertReportSchema>;

export interface Crisis {
  id: string;
  title: string;
  description: string;
  area: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "active" | "monitoring" | "resolved";
  reportCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Signal {
  id: string;
  title: string;
  description: string;
  area: string;
  category: string;
  trend: "rising" | "stable" | "declining";
  reportCount: number;
  lastUpdated: string;
}

export interface Stats {
  totalReports: number;
  criticalCases: number;
  pendingCases: number;
  topArea: string;
  avgSeverity: number;
  resolvedCases: number;
}

export interface AIHypothesis {
  text: string;
  likelihood: "high" | "medium" | "low";
  evidence: string[];
}

export interface AIWatchPoint {
  metric: string;
  threshold: string;
  why: string;
}

export interface AIAnalysis {
  narrative: string;
  hypotheses: AIHypothesis[];
  watchPoints: AIWatchPoint[];
  sampleReports: { id: string; title: string; category: string; area: string }[];
  confidence: number;
  disclaimer: string;
}

export interface Organization {
  id: string;
  name: string;
  nameAr: string;
  type: "un" | "ngo" | "gov" | "ingo";
}

export interface User {
  id: string;
  username: string;
  password: string;
  displayName: string;
  orgId: string;
  role: "admin" | "analyst" | "viewer";
}

export type SafeUser = Omit<User, "password">;

export interface AnalysisRecord {
  id: string;
  crisisId: string;
  analysis: AIAnalysis;
  status: "pending" | "approved" | "rejected";
  generatedAt: string;
  reviewedBy: string;
  reviewerName: string;
  reviewerNote: string;
  reviewedAt: string;
}

export interface AuditEntry {
  id: string;
  userId: string;
  userName: string;
  orgId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  timestamp: string;
}

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
