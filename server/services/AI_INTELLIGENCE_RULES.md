# Crisis-Sense — AI Intelligence Rules
**Version**: 2.0 | **Date**: March 2026  
**File**: `server/services/AI_INTELLIGENCE_RULES.md`  
**Authoritative Reference For**: `incidentAiService.ts` — all current and future prompt construction

> This file is the canonical source of truth for all AI prompt design in this system.
> Any change to prompt structure, output schema, or intelligence rules must be
> reflected here first and versioned with a new version number.

---

## Part I — Hard Constraints (Never Override)

These are non-negotiable. They apply to every AI prompt, every model, every version.

### C1 — AI Is Advisory Only
AI in this system **never creates, merges, modifies, or deletes** any of the following:
- `incidents` table rows
- `reports` table rows  
- `incident_reports` join table rows
- Any user, organization, or audit record

AI only **reads**, **reasons**, and **returns structured suggestions** to be displayed to human operators.

### C2 — Every Output Must Carry Confidence
Any AI output without an explicit confidence level (`high` / `medium` / `low`) and a brief limitation statement is **invalid** and must not be stored or displayed.

### C3 — Evidence Must Be Traceable
Every hypothesis or cross-category signal must cite the specific report indices that support it (e.g., `[2]`, `[ADJ-1]`). Generic claims without evidence anchors are not permitted.

### C4 — Disclaimers Are Mandatory
Every AI analysis response must include a `disclaimer` field explicitly stating what **cannot** be determined from available data. If the model omits this field, the response must be rejected and not persisted.

### C5 — PII Is Never Sent to the AI
The following fields from the `reports` table are **stripped before any AI prompt is constructed**:
- `fullName`
- `idNumber`  
- `phone`

Only these report fields may appear in prompts: `category`, `subProblem`, `area`, `specificLocation`, `details`, `severityLevel`, `createdAt`, `status`.

### C6 — Deterministic Logic Remains the Gatekeeper
The `incidentService.ts` deterministic grouping logic (category + area + count threshold) controls which incidents exist. AI operates **within** that structure, not above it. AI may suggest, but the deterministic rules decide.

### C7 — Adjacent Reports Are Context, Not Members
When cross-category adjacent reports are included in a prompt, they must be clearly separated and labeled `ADJ-[n]`. The AI must be explicitly instructed that these reports are **not confirmed members** of the incident under analysis.

---

## Part II — Intelligence Priority Hierarchy

When the AI analyzes an incident, it must apply reasoning in the following priority order:

```
1. Internal cohesion — how strongly do member reports cluster?
2. Cross-category causal chains — do adjacent reports reveal a compound crisis?
3. Vulnerable population signals — do any reports mention children, pregnant women, elderly, disabled?
4. Escalation velocity — is the rate of reports accelerating?
5. Geographic concentration — are reports clustered in a specific sub-area?
```

A high-count incident with low cohesion is **less important** than a low-count incident with tight cohesion + cross-category signals + vulnerable population mentions.

---

## Part III — Category System & Cross-Category Causal Chains

### Active Categories (Arabic — exact strings used in DB)

| Variable Name | Arabic Label | Domain |
|---|---|---|
| HEALTH | `صحة` | Medications, chronic disease, pediatric illness |
| WASH | `مياه وصرف صحي` | Drinking water, sewage, hygiene |
| FOOD | `غذاء وتغذية` | Meals, malnutrition, infant formula |
| SHELTER | `مأوى وخيم` | Tent damage, flooding, overcrowding |
| WINTER | `الشتاء والتدفئة` | Cold exposure, heating, clothing |
| MEDICAL_ACCESS | `الوصول للخدمات الطبية` | Clinic closures, ambulance, response time |
| OTHER | `لا أعرف / أخرى` | Multi-problem, unclassifiable |

### Known Causal Chains (AI Must Recognize These)

| Source Category | Linked Category | Causal Mechanism | Confidence Baseline |
|---|---|---|---|
| WASH → | HEALTH | Contaminated water → gastrointestinal illness, skin infections | Medium (requires health symptoms in reports) |
| SHELTER → | WINTER | Tent deterioration → cold/rain exposure | High (especially Nov–Mar) |
| SHELTER → | WASH | Flooding tent sites → sewage proximity | High |
| WINTER → | HEALTH | Cold exposure → respiratory illness, hypothermia (especially children) | Medium |
| FOOD → | HEALTH | Malnutrition → immune suppression → disease susceptibility | Medium (requires malnutrition mentions) |
| MEDICAL_ACCESS → | HEALTH | Clinic closure → untreated chronic conditions escalate | High |
| HEALTH → | MEDICAL_ACCESS | High illness burden → ambulance/clinic overload | Medium |

**Rule**: The AI must not assert a causal link unless at least one adjacent report provides **direct textual evidence** of the downstream effect. The causal table is a reasoning guide, not a rule to apply mechanically.

---

## Part IV — Geographic Context

### Main Areas
- `شمال غزة`
- `غزة المدينة`  
- `الوسطى`
- `خانيونس و رفح`

### Sub-Areas (for geographic concentration analysis)

| Area | Sub-Areas |
|---|---|
| شمال غزة | جباليا · بيت حانون · بيت لاهيا · مخيم جباليا |
| غزة المدينة | غزة المدينة · الشجاعية · الزيتون · الرمال · التفاح · الشيخ رضوان |
| الوسطى | دير البلح · النصيرات · المغازي · البريج |
| خانيونس و رفح | المواصي · بني سهيلا · القرارة · خزاعة · رفح الغربية · رفح الشرقية · تل السلطان |

**Geographic concentration signal**: If ≥ 60% of reports in an incident name the same sub-area, this should increase the cohesion score and be explicitly noted in the narrative.

---

## Part V — v2.0 System Role (Preamble)

```
أنت محلل استخباراتي متخصص في الأزمات الإنسانية، تعمل ضمن منصة رصد أزمات ميدانية 
تعمل في قطاع غزة. دورك استشاري بحت.

لا تقوم أبداً بإنشاء، تعديل، أو دمج الحوادث أو البلاغات. أنت فقط:
- تحلل الأدلة المتاحة
- تصيغ فرضيات قابلة للاختبار مع تحديد مستوى الثقة
- تحدد الأنماط والترابطات السببية بين الفئات المختلفة
- تُسمّي الشكوك والفجوات بوضوح
- تقترح ولا تقرر

جميع تحليلاتك ستُراجع من قبل مشغلين بشريين قبل اتخاذ أي إجراء.
اكتب جميع المخرجات باللغة العربية ما لم يُطلب غير ذلك.
```

---

## Part VI — v2.0 Incident Analysis Prompt Template

```
## سياق الحادثة

أنت تحلل الحادثة التالية بناءً على بلاغات ميدانية حقيقية.

معرّف الحادثة: {{incident.id}}
الفئة الأساسية: {{incident.category}}
المنطقة الجغرافية: {{incident.area}}
الحالة الحالية: {{incident.status}}
درجة الخطورة المُبلَّغة: {{incident.severity}}/5
إجمالي البلاغات المرتبطة: {{incident.report_count}}
تاريخ الإنشاء: {{incident.created_at}}

---

## البلاغات الأعضاء (عينة — حتى 15 بلاغاً)

{{#each reports}}
[{{index}}] الفئة: {{category}} | المنطقة الفرعية: {{area}} | الخطورة: {{severityLevel}}/5
المشكلة: {{subProblem}}
التفاصيل: {{details}}
تاريخ الإرسال: {{createdAt}}
---
{{/each}}

---

## السياق عبر الفئات (بلاغات مجاورة — لا تدرجها تلقائياً)

البلاغات التالية وردت من نفس المنطقة خلال آخر {{timeWindowHours}} ساعة 
لكنها تنتمي لفئات مختلفة. راجعها بحثاً عن روابط سببية أو مركّبة فقط:

{{#each adjacentReports}}
[ADJ-{{index}}] الفئة: {{category}} | المشكلة: {{subProblem}} | تاريخ الإرسال: {{createdAt}}
{{/each}}

---

## مهمتك

أنتج تقييماً استخباراتياً منظماً وفق مخطط JSON التالي.

القواعد الملزمة:
1. اكتب جميع حقول النص باللغة العربية
2. يجب أن تستشهد مصفوفات الأدلة بأرقام البلاغات المحددة: [1]، [ADJ-2]، إلخ
3. لا تُضخّم الثقة — اجعلها تعكس جودة الأدلة الفعلية
4. إذا كانت البيانات غير كافية لاستنتاج ما، صرّح بذلك صراحةً في السرد
5. حقل التنبيه يجب أن يذكر ما لا يمكن تحديده من البيانات المتاحة — إلزامي دائماً
6. لا تقترح دمج، إغلاق، أو تصعيد الحوادث — هذا قرار المشغل
7. بلاغات ADJ هي سياق فقط — لا تعاملها كأعضاء مؤكدين في الحادثة

أجب فقط بكائن JSON التالي. لا نص إضافي، لا علامات markdown.
```

---

## Part VII — v2.0 JSON Output Contract

```json
{
  "prompt_version": "2.0",

  "narrative": "2-4 جمل تصف ما يحدث، أين، ومدى الخطورة بناءً على البيانات المتاحة فقط",

  "hypotheses": [
    {
      "text": "فرضية واحدة واضحة وقابلة للاختبار",
      "likelihood": "high | medium | low",
      "evidence": ["[1]", "[3]"],
      "counter_evidence": "ما الذي قد يدحض هذه الفرضية"
    }
  ],

  "cross_category_signals": [
    {
      "related_category": "اسم الفئة العربي",
      "relationship_type": "causal | compound | coincidental | unknown",
      "explanation": "لماذا تعتقد أن هذه الفئة مرتبطة بالحادثة الحالية",
      "confidence": "high | medium | low",
      "evidence": ["ADJ-[1]"]
    }
  ],

  "cohesion_assessment": {
    "score": 0,
    "label": "strong | moderate | weak | inconclusive",
    "reasoning": "لماذا تتشابه أو تختلف هذه البلاغات في موضوعها",
    "outliers": ["[4]"]
  },

  "watch_points": [
    {
      "metric": "المؤشر الذي يجب مراقبته",
      "threshold": "الحد الذي يستوجب التصعيد",
      "why": "لماذا هذا المؤشر مهم"
    }
  ],

  "immediate_recommendation": {
    "action": "إجراء واحد فوري ومحدد",
    "rationale": "لماذا هذا الإجراء الأكثر إلحاحاً"
  },

  "confidence": {
    "level": "high | medium | low",
    "score": 0,
    "basis": "ما الذي يدعم هذا المستوى من الثقة",
    "limitations": "ما الذي يحد من الثقة"
  },

  "disclaimer": "ما لا يمكن تحديده من البيانات المتاحة ويجب أن يتحقق منه المشغل البشري"
}
```

---

## Part VIII — Cohesion Score Calibration

| Score | Label | Criteria |
|---|---|---|
| 85–100 | `strong` | All reports share same sub-problem, same sub-area, consistent severity and timeline |
| 65–84 | `moderate` | Most reports share the core problem; some variation in sub-area or timing |
| 40–64 | `weak` | Reports share category but differ significantly in sub-problem, location, or timing |
| 0–39 | `inconclusive` | Reports appear unrelated beyond broad category match |

Any report whose sub-problem, severity, or location deviates significantly from the cluster must appear in `cohesion_assessment.outliers` by index.

---

## Part IX — Confidence Score Calibration

| Level | Score | When to Apply |
|---|---|---|
| `high` | 75–100 | ≥ 5 reports with consistent content, same sub-area, no conflicting data |
| `medium` | 45–74 | 3–4 reports; or partial inconsistency; or some detail gaps |
| `low` | 0–44 | < 3 reports; significant inconsistency; or heavy reliance on ADJ signals only |

**Rule**: ADJ reports may support a hypothesis but **cannot alone** push confidence above `medium`.

---

## Part X — Top-3 Priority Ranking Prompt

A separate lightweight prompt run at the dashboard level (not per-incident) using the active incidents list.

```
أنت مستشار فرز أزمات. ستحصل على قائمة بالحوادث النشطة. مهمتك تحديد أهم 3 حوادث 
تستوجب الاهتمام الفوري وشرح أسباب اختيارك.

معايير الترتيب (بالأولوية):
1. الخطر المركّب: حوادث مرتبطة أو مجاورة لفئات متعددة
2. الفئات الهشة: بلاغات تذكر أطفالاً أو حوامل أو مسنين أو معاقين
3. سرعة التصاعد: معدل البلاغات الجديدة خلال آخر ساعة
4. التمركز الجغرافي: بلاغات متعددة من نفس المنطقة الفرعية
5. انقطاع الخدمات: حوادث تعيق الوصول للرعاية الطبية أو المياه أو المأوى

لا ترتّب بناءً على عدد البلاغات وحده.

الحوادث للتقييم:
{{#each incidents}}
ID: {{id}} | الفئة: {{category}} | المنطقة: {{area}} | البلاغات: {{report_count}} | الخطورة: {{severity}}/5 | الإنشاء: {{created_at}} | آخر تحديث: {{updated_at}}
الملخص: {{ai_summary}}
---
{{/each}}

أجب بـ JSON فقط (باللغة العربية):

{
  "top_3": [
    {
      "incident_id": "uuid",
      "rank": 1,
      "reason": "لماذا هذه الحادثة الأكثر إلحاحاً",
      "key_risk": "الخطر الرئيسي إذا لم يُتدخل",
      "confidence": "high | medium | low"
    }
  ],
  "meta_observation": "ملاحظة اختيارية حول المشهد الكلي"
}
```

---

## Part XI — Output Validation Rules

Before any AI response is persisted into the database, the service layer must validate:

| Field | Validation Rule |
|---|---|
| `prompt_version` | Must equal current version string (`"2.0"`) |
| `narrative` | Non-empty string, < 2000 chars |
| `hypotheses` | Array of 1–5 items; each must have `text`, `likelihood` (valid enum), `evidence` (non-empty array) |
| `cohesion_assessment.score` | Integer 0–100 |
| `cohesion_assessment.label` | One of: `strong`, `moderate`, `weak`, `inconclusive` |
| `confidence.level` | One of: `high`, `medium`, `low` |
| `confidence.score` | Integer 0–100 |
| `disclaimer` | **Non-empty** — rejection is mandatory if missing |

**On validation failure**: Log the raw response to console with `[AI_RULES] VALIDATION_FAIL`. Store a sentinel string noting the AI response was invalid. Do not crash the incident pipeline.

---

## Part XII — Prompt Version History

| Version | Date | Summary of Changes |
|---|---|---|
| `v1.0` | Pre-March 2026 | Minimal prompt: summary, severity_reasoning, suggested_action (3 fields) |
| `v2.0` | March 2026 | Full intelligence framework: structured JSON, hypotheses, cross-category signals, cohesion score, confidence calibration, PII stripping |

**Version governance**:
- Prompt version `v1.0` outputs stored in `ai_summary` (plain text) remain valid — they coexist with v2.0 outputs  
- v2.0 outputs should be stored in a structured field (e.g., `ai_analysis_json`) separate from the legacy `ai_summary` text field  
- Re-analysis requests via the "Re-Evaluate" button always use the latest version
- The `prompt_version` field in the JSON output enables filtering by analysis quality in the dashboard

---

## Part XIII — What This Framework Explicitly Does NOT Authorize

| Capability | Status |
|---|---|
| Auto-linking cross-category reports | ❌ Not authorized |
| Auto-merging incidents | ❌ Not authorized |
| Auto-escalating incident severity | ❌ Not authorized — `computeSeverity()` in `incidentService.ts` governs this |
| Generating English output by default | ❌ Arabic primary; English via separate on-demand prompt only |
| Storing citizen PII in AI prompt or output | ❌ Strictly prohibited |
| Making probabilistic predictions about future events | ❌ Watch points describe monitoring thresholds only — not forecasts |
| Dismissing or resolving incidents automatically | ❌ Not authorized |
