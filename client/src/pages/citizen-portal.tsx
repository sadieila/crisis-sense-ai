import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { categories, areas, subAreas } from "@shared/schema";
import type { InsertReport } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { createTranslator } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import {
  HeartPulse, Droplets, UtensilsCrossed, Home, Thermometer,
  Ambulance, CircleHelp, ShieldCheck, CheckCircle, ArrowRight,
  ArrowLeft, Send, MapPin, Info, Lightbulb,
  Shield, Users, Building2, Lock, Globe
} from "lucide-react";

const iconMap: Record<string, any> = {
  HeartPulse, Droplets, UtensilsCrossed, Home, Thermometer,
  Ambulance, CircleHelp
};

export default function CitizenPortal() {
  const [currentStep, setCurrentStep] = useState(0);
  const [lang, setLang] = useState<Lang>("ar");
  const t = createTranslator(lang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  const [formData, setFormData] = useState<InsertReport>({
    category: "",
    subProblem: "",
    area: "",
    specificLocation: "",
    details: "",
    fullName: "",
    idNumber: "",
    phone: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const submitMutation = useMutation({
    mutationFn: async (payload: InsertReport) => {
      const res = await apiRequest("POST", "/api/reports", payload);
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (error: Error) => {
      toast({
        title: "خطأ في الإرسال",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const totalSteps = 4;
  const progress = ((currentStep + 1) / totalSteps) * 100;

  const selectCategory = (cat: string) => {
    setFormData({ ...formData, category: cat, subProblem: "" });
    setCurrentStep(1);
  };

  const selectArea = (area: string) => {
    setFormData({ ...formData, area, specificLocation: "" });
    setCurrentStep(3);
  };

  const nextStep = () => {
    if (currentStep === 1 && !formData.subProblem) {
      toast({ title: "الرجاء اختيار المشكلة", variant: "destructive" });
      return;
    }
    setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    setCurrentStep(currentStep - 1);
  };

  const handleSubmit = () => {
    if (submitMutation.isPending) {
      return;
    }

    const category = formData.category?.trim() || "";
    const subProblem = formData.subProblem?.trim() || "";
    const area = formData.area?.trim() || "";

    if (!category || !subProblem || !area) {
      toast({ title: "الرجاء إكمال الحقول المطلوبة", variant: "destructive" });
      return;
    }

    const details = formData.details?.trim() || "";
    const specificLocation = formData.specificLocation?.trim() || undefined;
    const payload: InsertReport = {
      category,
      subProblem,
      area,
      specificLocation,
      details,
      fullName: formData.fullName?.trim() || "",
      idNumber: formData.idNumber?.trim() || "",
      phone: formData.phone?.trim() || "",
    };

    submitMutation.mutate(payload);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100 dark:bg-slate-950">
        <Card className="max-w-[600px] w-full p-8 text-center border" dir={dir}>
          <div className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center bg-emerald-600">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-3 text-emerald-700 dark:text-emerald-400" data-testid="text-success-title">
            {t("success_title")}
          </h2>
          <p className="text-muted-foreground text-base mb-8 leading-relaxed" data-testid="text-success-message">
            {t("success_message")}
          </p>
          <Button
            onClick={() => { setSubmitted(false); setCurrentStep(0); setFormData({ category: "", subProblem: "", area: "", specificLocation: "", details: "", fullName: "", idNumber: "", phone: "" }); }}
            className="mx-auto bg-slate-800 hover:bg-slate-700 text-white"
            data-testid="button-back-home"
          >
            <Home className="w-4 h-4 ml-2" />
            {t("btn_new_report")}
          </Button>
        </Card>
      </div>
    );
  }

  if (currentStep === 0 && !formData.category) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col" dir={dir}>
        <div className="sticky top-0 z-50 bg-slate-800 dark:bg-slate-900 text-white py-2.5">
          <div className="max-w-[1200px] mx-auto px-4 flex justify-between items-center text-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-slate-300" />
              <span className="font-semibold">CrisisSense AI</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t("badge_secure")}</span>
              </div>
              <button
                onClick={() => setLang(lang === "ar" ? "en" : "ar")}
                className="flex items-center gap-1 text-xs text-slate-300 hover:text-white border border-slate-600 hover:border-slate-400 rounded px-2 py-1 transition-colors"
                data-testid="button-lang-toggle"
                title="Switch language"
              >
                <Globe className="w-3 h-3" />
                {t("lang_toggle")}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center p-4 flex-1">
          <Card className="max-w-[600px] w-full p-8 border">
            <h1 className="text-2xl font-bold text-center mb-2 text-foreground" data-testid="text-portal-title">
              {t("portal_title")}
            </h1>
            <p className="text-muted-foreground text-center mb-8" data-testid="text-portal-subtitle">{t("portal_subtitle")}</p>

            <div className="rounded-lg p-6 mb-6 bg-slate-800 dark:bg-slate-800 text-white text-center">
              <h3 className="text-lg font-bold mb-2">{lang === "ar" ? "ابدأ بإرسال بلاغك" : "Start your report"}</h3>
              <p className="mb-4 text-slate-300 text-sm">{lang === "ar" ? <><strong className="text-white">سريع وآمن</strong> — لن يستغرق أكثر من دقيقتين</> : <><strong className="text-white">Fast & secure</strong> — takes less than 2 minutes</>}</p>
              <Button
                onClick={() => setCurrentStep(0.5)}
                className="w-full text-base py-5 bg-white text-slate-800 hover:bg-slate-100 font-semibold"
                data-testid="button-start-report"
              >
                <Send className="w-4 h-4 ml-2" />
                {t("btn_submit").replace("البلاغ", "").trim() || (lang === "ar" ? "إرسال بلاغ جديد" : "Start New Report")}
              </Button>
            </div>

            <div className="rounded-lg p-4 mb-6 flex gap-4 border bg-muted/30">
              <Shield className="w-8 h-8 text-slate-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>{lang === "ar" ? "بياناتك محمية ومشفرة" : "Your data is protected and encrypted"}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>{lang === "ar" ? "وصول مباشر للمنظمات الإنسانية" : "Direct access to humanitarian organizations"}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>{lang === "ar" ? "متابعة فورية للحالات العاجلة" : "Immediate follow-up on urgent cases"}</span>
                </div>
              </div>
            </div>

            <div className="text-center text-sm text-muted-foreground mb-4">
              <Users className="w-4 h-4 inline ml-1" />
              {lang === "ar" ? "منصة مدعومة بالذكاء الاصطناعي لخدمة المجتمع" : "AI-powered platform serving the community"}
            </div>

            <div className="text-center pt-4 border-t">
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground font-medium inline-flex items-center gap-2 transition-colors" data-testid="link-dashboard">
                <Building2 className="w-4 h-4" />
                {lang === "ar" ? "دخول المنظمات الإنسانية" : "Organization Login"}
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const renderStepContent = () => {
    if (currentStep === 0.5 || (currentStep === 0 && formData.category)) {
      return (
        <div>
          <h3 className="text-base font-bold mb-4 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-slate-500" />
            اختر نوع الاحتياج
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(categories).map(([cat, data]) => {
              const IconComp = iconMap[data.icon] || CircleHelp;
              return (
                <button
                  key={cat}
                  onClick={() => selectCategory(cat)}
                  className={`p-4 rounded-lg border text-right flex items-center gap-3 transition-all ${formData.category === cat
                    ? "border-slate-500 bg-slate-50 dark:bg-slate-800/50"
                    : "border-border bg-card hover:bg-muted/30"
                    }`}
                  data-testid={`button-category-${cat}`}
                >
                  <div className="text-slate-500">
                    <IconComp className="w-6 h-6" />
                  </div>
                  <span className="font-medium text-sm">{cat}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (currentStep === 1) {
      const problems = categories[formData.category]?.problems || [];
      return (
        <div>
          <h3 className="text-base font-bold mb-3 flex items-center gap-2">
            <Info className="w-5 h-5 text-slate-500" />
            صف احتياجك بالتفصيل
          </h3>
          <div className="rounded-lg p-3 mb-4 flex gap-2 bg-muted/30 border text-sm" style={{ borderRight: "3px solid hsl(var(--muted-foreground) / 0.3)" }}>
            <span>الفئة: <strong>{formData.category}</strong></span>
          </div>
          <div className="mb-4">
            <label className="block font-medium text-sm mb-2">ما هي المشكلة بالتحديد؟ <span className="text-red-500">*</span></label>
            <select
              value={formData.subProblem}
              onChange={(e) => setFormData({ ...formData, subProblem: e.target.value })}
              className="w-full p-3 rounded-lg border bg-card text-foreground focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 outline-none transition-all text-sm"
              data-testid="select-sub-problem"
            >
              <option value="">-- اختر المشكلة --</option>
              {problems.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-sm mb-2">
              تفاصيل إضافية <span className="text-muted-foreground font-normal">(اختياري)</span>
            </label>
            <textarea
              value={formData.details}
              onChange={(e) => setFormData({ ...formData, details: e.target.value })}
              placeholder="اشرح الموقف بالتفصيل..."
              className="w-full p-3 rounded-lg border bg-card text-foreground focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 outline-none transition-all min-h-[120px] resize-y text-sm"
              data-testid="input-details"
            />
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Lightbulb className="w-3.5 h-3.5" />
              كلما كانت التفاصيل أوضح، كانت المساعدة أسرع
            </p>
          </div>
        </div>
      );
    }

    if (currentStep === 2) {
      return (
        <div>
          <h3 className="text-base font-bold mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-slate-500" />
            أين أنت؟
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {areas.map((area) => (
              <button
                key={area}
                onClick={() => selectArea(area)}
                className={`p-4 rounded-lg border text-right flex items-center gap-3 transition-all ${formData.area === area
                  ? "border-slate-500 bg-slate-50 dark:bg-slate-800/50"
                  : "border-border bg-card hover:bg-muted/30"
                  }`}
                data-testid={`button-area-${area}`}
              >
                <MapPin className="w-5 h-5 text-slate-500" />
                <span className="font-medium text-sm">{area}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (currentStep === 3) {
      const locations = subAreas[formData.area] || [];
      return (
        <div>
          <h3 className="text-base font-bold mb-3 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-slate-500" />
            معلومات اختيارية
          </h3>
          <div className="rounded-lg p-3 mb-4 flex gap-2 bg-muted/30 border text-sm" style={{ borderRight: "3px solid hsl(var(--muted-foreground) / 0.3)" }}>
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>تماماً اختياري!</strong><br />
              يمكنك تخطي هذا القسم. نضعه فقط لو أردت أن تتواصل معك الجهات للمتابعة.
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block font-medium text-sm mb-2">الاسم الرباعي <span className="text-muted-foreground font-normal">(اختياري)</span></label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                placeholder="الاسم كامل"
                className="w-full p-3 rounded-lg border bg-card text-foreground focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 outline-none transition-all text-sm"
                data-testid="input-fullname"
              />
            </div>
            <div>
              <label className="block font-medium text-sm mb-2">رقم الهاتف <span className="text-muted-foreground font-normal">(اختياري)</span></label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="مثال: 0591234567"
                dir="rtl"
                style={{ direction: "rtl", textAlign: "right" }}
                className="w-full p-3 rounded-lg border bg-card text-foreground focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 outline-none transition-all text-sm text-right"
                data-testid="input-phone"
              />
            </div>
            <div>
              <label className="block font-medium text-sm mb-2">رقم الهوية <span className="text-muted-foreground font-normal">(اختياري)</span></label>
              <input
                type="text"
                value={formData.idNumber}
                onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
                placeholder="مثال: 987654321"
                className="w-full p-3 rounded-lg border bg-card text-foreground focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 outline-none transition-all text-sm"
                data-testid="input-id-number"
              />
            </div>
            <div>
              <label className="block font-medium text-sm mb-2">الموقع الدقيق <span className="text-muted-foreground font-normal">(اختياري)</span></label>
              <select
                value={formData.specificLocation ?? ""}
                onChange={(e) => setFormData({ ...formData, specificLocation: e.target.value })}
                className="w-full p-3 rounded-lg border bg-card text-foreground focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 outline-none transition-all text-sm"
                data-testid="select-specific-location"
              >
                <option value="">-- اختر الموقع الدقيق --</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                المنطقة المختارة: <strong>{formData.area}</strong>
              </p>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const actualStep = currentStep === 0.5 ? 0 : currentStep;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col">
      <div className="sticky top-0 z-50 bg-slate-800 dark:bg-slate-900 text-white py-2.5">
        <div className="max-w-[1200px] mx-auto px-4 flex justify-between items-center text-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-slate-300" />
            <span className="font-semibold">CrisisSense AI</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>مشفّر وآمن</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-4 flex-1">
        <Card className="max-w-[600px] w-full p-6 sm:p-8 border">
          <Progress value={progress} className="mb-6 h-1.5" data-testid="progress-bar" />

          <div className="flex justify-between mb-6 relative px-5">
            <div className="absolute top-1/2 right-10 left-10 h-px bg-border -translate-y-1/2 z-0" />
            {[1, 2, 3, 4].map((num) => (
              <div
                key={num}
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm relative z-10 border-2 transition-all ${num - 1 < actualStep
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : num - 1 === actualStep
                    ? "bg-slate-700 border-slate-700 text-white"
                    : "bg-card border-border text-muted-foreground"
                  }`}
                data-testid={`step-indicator-${num}`}
              >
                {num - 1 < actualStep ? <CheckCircle className="w-4 h-4" /> : num}
              </div>
            ))}
          </div>

          {renderStepContent()}

          {currentStep !== 0.5 && currentStep > 0 && (
            <div className="flex gap-3 mt-6 flex-col-reverse sm:flex-row">
              {currentStep > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => currentStep === 1 ? setCurrentStep(0.5) : prevStep()}
                  disabled={submitMutation.isPending}
                  className="flex-1"
                  data-testid="button-prev-step"
                >
                  <ArrowRight className="w-4 h-4 ml-2" />
                  السابق
                </Button>
              )}
              {currentStep < 3 ? (
                <Button
                  onClick={nextStep}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white"
                  data-testid="button-next-step"
                >
                  التالي
                  <ArrowLeft className="w-4 h-4 mr-2" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white"
                  data-testid="button-submit-report"
                >
                  {submitMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      جاري الإرسال...
                    </span>
                  ) : (
                    <>
                      <Send className="w-4 h-4 ml-2" />
                      إرسال البلاغ
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
