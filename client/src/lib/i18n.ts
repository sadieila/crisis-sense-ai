/**
 * i18n.ts — Citizen Portal translations
 *
 * Usage:
 *   const t = useTranslation();
 *   t("submit_report")  // → "Submit Report" or "إرسال البلاغ"
 *
 * Rules:
 * - Only UI chrome is translated (labels, buttons, instructions)
 * - Category names, area names, and sub-problems are server-driven
 *   (they come from shared/schema.ts) and are NOT translated here
 * - User-entered free text is never translated
 */

export type Lang = "ar" | "en";

export const translations = {
    // ── Navigation / header ────────────────────────────────────────────────────
    portal_title: {
        ar: "بوابة الإبلاغ عن الأزمات",
        en: "Crisis Reporting Portal",
    },
    portal_subtitle: {
        ar: "أبلغ عن حالة طارئة أو احتياج إنساني في منطقتك",
        en: "Report an emergency or humanitarian need in your area",
    },
    lang_toggle: {
        ar: "English",
        en: "عربي",
    },

    // ── Progress steps ─────────────────────────────────────────────────────────
    step_category: { ar: "الفئة", en: "Category" },
    step_problem: { ar: "المشكلة", en: "Problem" },
    step_location: { ar: "الموقع", en: "Location" },
    step_details: { ar: "التفاصيل", en: "Details" },
    step_contact: { ar: "بيانات التواصل", en: "Contact" },

    // ── Category step ──────────────────────────────────────────────────────────
    select_category: {
        ar: "اختر فئة المشكلة",
        en: "Select a problem category",
    },
    category_prompt: {
        ar: "ما نوع الأزمة أو الاحتياج الذي تواجهه؟",
        en: "What type of crisis or need are you facing?",
    },

    // ── Sub-problem step ───────────────────────────────────────────────────────
    select_problem: { ar: "حدد المشكلة", en: "Specify the problem" },
    select_problem_prompt: {
        ar: "ما هي المشكلة تحديداً؟",
        en: "What is the specific problem?",
    },

    // ── Area step ──────────────────────────────────────────────────────────────
    select_area: { ar: "اختر المنطقة", en: "Select area" },
    select_area_prompt: {
        ar: "في أي منطقة تقع المشكلة؟",
        en: "In which area is the problem located?",
    },
    specific_location_label: {
        ar: "موقع تفصيلي (اختياري)",
        en: "Specific location (optional)",
    },
    specific_location_placeholder: {
        ar: "مثال: بالقرب من المدرسة الابتدائية",
        en: "e.g., Near the primary school",
    },

    // ── Details step ──────────────────────────────────────────────────────────
    details_label: { ar: "تفاصيل إضافية (اختياري)", en: "Additional details (optional)" },
    details_placeholder: {
        ar: "صف الوضع بمزيد من التفاصيل...",
        en: "Describe the situation in more detail...",
    },

    // ── Contact step ──────────────────────────────────────────────────────────
    contact_optional: {
        ar: "بيانات التواصل (اختيارية)",
        en: "Contact details (optional)",
    },
    contact_note: {
        ar: "لن يتم مشاركة بياناتك مع أي جهة خارجية",
        en: "Your information will not be shared with any third party",
    },
    full_name_label: { ar: "الاسم الكامل", en: "Full name" },
    full_name_placeholder: { ar: "اسمك الكامل", en: "Your full name" },
    id_number_label: { ar: "رقم الهوية", en: "ID number" },
    id_number_placeholder: { ar: "رقم الهوية الوطنية", en: "National ID number" },
    phone_label: { ar: "رقم الهاتف", en: "Phone number" },
    phone_placeholder: { ar: "05XXXXXXXX", en: "05XXXXXXXX" },

    // ── Buttons ────────────────────────────────────────────────────────────────
    btn_next: { ar: "التالي", en: "Next" },
    btn_back: { ar: "رجوع", en: "Back" },
    btn_submit: { ar: "إرسال البلاغ", en: "Submit Report" },
    btn_submitting: { ar: "جاري الإرسال...", en: "Submitting..." },
    btn_new_report: { ar: "إرسال بلاغ جديد", en: "Submit Another Report" },

    // ── Success screen ────────────────────────────────────────────────────────
    success_title: { ar: "تم استلام البلاغ", en: "Report Received" },
    success_message: {
        ar: "شكراً لك. تم تسجيل بلاغك وسيتم مراجعته في أقرب وقت.",
        en: "Thank you. Your report has been recorded and will be reviewed shortly.",
    },

    // ── Trust badges ─────────────────────────────────────────────────────────
    badge_secure: { ar: "آمن وموثوق", en: "Secure & Trusted" },
    badge_anonymous: { ar: "سري وخاص", en: "Private & Anonymous" },
    badge_fast: { ar: "معالجة سريعة", en: "Fast Processing" },

    // ── Validation / errors ───────────────────────────────────────────────────
    field_required: { ar: "هذا الحقل مطلوب", en: "This field is required" },
    submit_error: {
        ar: "حدث خطأ أثناء الإرسال. حاول مرة أخرى.",
        en: "An error occurred while submitting. Please try again.",
    },
} as const satisfies Record<string, Record<Lang, string>>;

export type TranslationKey = keyof typeof translations;

/** Returns a typed translator function for the given language. */
export function createTranslator(lang: Lang) {
    return function t(key: TranslationKey): string {
        return translations[key][lang];
    };
}
