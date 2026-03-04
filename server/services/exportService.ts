/**
 * exportService.ts
 *
 * Produces professional Excel (.xlsx) exports for incidents.
 *
 * DESIGN RULES:
 *  - All Arabic text is preserved as-is (UTF-8, no translation)
 *  - RTL alignment applied to all Arabic text columns
 *  - PII fields (fullName, idNumber, phone) are excluded
 *  - A visible confidentiality footer is added to every sheet
 *  - Export action is logged by the caller (routes.ts)
 *
 * OUTPUT SHEETS:
 *  1. "ملخص الحادثة"   — Incident summary
 *  2. "البلاغات المرتبطة" — Member reports (no PII)
 *  3. "تحليل الذكاء الاصطناعي" — AI analysis summary
 */

import ExcelJS from "exceljs";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IncidentRow {
    id: string;
    category: string;
    area: string;
    status: string;
    severity: number;
    report_count: number;
    ai_summary: string | null;
    created_at: string;
    updated_at: string;
}

export interface ReportRow {
    id: string;
    title: string | null;
    content: string | null;
    category: string | null;
    area: string | null;
    status: string;
    created_at: string;
}

export interface ExportActor {
    displayName: string;
    role: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString("ar-EG");
    } catch {
        return iso;
    }
}

function severityLabel(level: number): string {
    if (level >= 5) return "بالغة الخطورة (5)";
    if (level >= 4) return "عالية (4)";
    if (level >= 3) return "متوسطة (3)";
    if (level >= 2) return "منخفضة (2)";
    return "ضئيلة (1)";
}

function statusLabel(status: string): string {
    const map: Record<string, string> = {
        active: "نشط",
        monitoring: "قيد المراقبة",
        resolved: "مُغلق",
        pending: "معلق",
        in_progress: "جارٍ العمل عليه",
    };
    return map[status] ?? status;
}

/** Apply consistent Arabic column style: RTL, wrapped text, border */
function arabicStyle(ws: ExcelJS.Worksheet, col: ExcelJS.Column) {
    col.alignment = { horizontal: "right", vertical: "top", readingOrder: "rtl", wrapText: true };
}

/** Bold + filled header row */
function styleHeaderRow(row: ExcelJS.Row, fillColor = "1E3A5F") {
    row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fillColor}` } };
        cell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl", wrapText: true };
        cell.border = {
            top: { style: "thin" }, bottom: { style: "thin" },
            left: { style: "thin" }, right: { style: "thin" },
        };
    });
}

/** Standard data cell border */
function styleCells(rows: ExcelJS.Row[]) {
    for (const row of rows) {
        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = {
                top: { style: "hair" }, bottom: { style: "hair" },
                left: { style: "hair" }, right: { style: "hair" },
            };
        });
    }
}

/** Add watermark footer rows to a sheet */
function addFooter(
    ws: ExcelJS.Worksheet,
    actor: ExportActor,
    startRow: number,
) {
    const footerText = `تم التصدير بواسطة: ${actor.displayName} (${actor.role}) | التاريخ: ${new Date().toLocaleString("ar-EG")} | سري — غير مخصص للتوزيع العام`;
    const row = ws.getRow(startRow + 2);
    const cell = row.getCell(1);
    cell.value = footerText;
    cell.font = { italic: true, size: 9, color: { argb: "FF888888" } };
    cell.alignment = { horizontal: "right", readingOrder: "rtl" };
    // Merge across all columns used
    ws.mergeCells(startRow + 2, 1, startRow + 2, ws.columnCount || 5);
    row.commit();
}

// ── Sheet builders ────────────────────────────────────────────────────────────

function buildSummarySheet(
    wb: ExcelJS.Workbook,
    incident: IncidentRow,
    actor: ExportActor,
) {
    const ws = wb.addWorksheet("ملخص الحادثة");
    ws.views = [{ rightToLeft: true }];

    // Title
    ws.mergeCells("A1:C1");
    const titleCell = ws.getCell("A1");
    titleCell.value = "ملخص الحادثة — Crisis-Sense";
    titleCell.font = { bold: true, size: 14, name: "Calibri" };
    titleCell.alignment = { horizontal: "center", readingOrder: "rtl" };
    ws.getRow(1).height = 28;

    ws.addRow([]); // spacer

    // Data rows
    const rows: [string, string][] = [
        ["معرّف الحادثة", incident.id],
        ["الفئة", incident.category],
        ["المنطقة", incident.area],
        ["الحالة", statusLabel(incident.status)],
        ["درجة الخطورة", severityLabel(incident.severity)],
        ["عدد البلاغات", String(incident.report_count)],
        ["تاريخ الإنشاء", formatDate(incident.created_at)],
        ["آخر تحديث", formatDate(incident.updated_at)],
    ];

    ws.columns = [
        { header: "الحقل", key: "field", width: 26 },
        { header: "القيمة", key: "value", width: 55 },
    ];

    styleHeaderRow(ws.getRow(3));

    const dataRows: ExcelJS.Row[] = [];
    for (const [field, value] of rows) {
        const r = ws.addRow({ field, value });
        r.getCell(1).font = { bold: true };
        r.alignment = { readingOrder: "rtl", vertical: "top" };
        dataRows.push(r);
    }
    styleCells(dataRows);

    addFooter(ws, actor, ws.rowCount);
}

function buildReportsSheet(
    wb: ExcelJS.Workbook,
    reports: ReportRow[],
    actor: ExportActor,
) {
    const ws = wb.addWorksheet("البلاغات المرتبطة");
    ws.views = [{ rightToLeft: true }];

    ws.columns = [
        { header: "ID (مختصر)", key: "id", width: 14 },
        { header: "الفئة", key: "category", width: 26 },
        { header: "المنطقة", key: "area", width: 20 },
        { header: "الحالة", key: "status", width: 18 },
        { header: "العنوان / المحتوى", key: "content", width: 60 },
        { header: "تاريخ الإرسال", key: "created_at", width: 24 },
    ];

    styleHeaderRow(ws.getRow(1));

    const dataRows: ExcelJS.Row[] = [];
    for (const r of reports) {
        const row = ws.addRow({
            id: r.id.slice(0, 8),
            category: r.category ?? "—",
            area: r.area ?? "—",
            status: statusLabel(r.status),
            content: r.title ?? r.content?.slice(0, 300) ?? "—",
            created_at: formatDate(r.created_at),
        });
        row.alignment = { readingOrder: "rtl", vertical: "top", wrapText: true };
        dataRows.push(row);
    }
    styleCells(dataRows);

    // Note: PII columns deliberately omitted
    const noteRow = ws.addRow([]);
    ws.addRow([]);
    const noteCell = ws.getRow(ws.rowCount - 1).getCell(1);
    noteCell.value = "ملاحظة: لم يتم تضمين بيانات الهوية الشخصية (الاسم، رقم الهوية، الهاتف) في هذا التصدير.";
    noteCell.font = { italic: true, size: 9, color: { argb: "FF888888" } };
    ws.mergeCells(ws.rowCount - 1, 1, ws.rowCount - 1, 6);

    addFooter(ws, actor, ws.rowCount);
}

function buildAiSheet(
    wb: ExcelJS.Workbook,
    incident: IncidentRow,
    actor: ExportActor,
) {
    const ws = wb.addWorksheet("تحليل الذكاء الاصطناعي");
    ws.views = [{ rightToLeft: true }];

    ws.columns = [
        { header: "القسم", key: "section", width: 28 },
        { header: "المحتوى", key: "content", width: 80 },
    ];

    styleHeaderRow(ws.getRow(1));

    const aiText = incident.ai_summary;

    const rows: [string, string][] = aiText
        ? [
            ["نسخة المحلل", "v1.0"],
            ["ملخص التحليل", aiText],
            ["حالة التحليل", "مكتمل"],
        ]
        : [
            ["حالة التحليل", "لم يتم تشغيل تحليل الذكاء الاصطناعي لهذه الحادثة بعد."],
        ];

    const dataRows: ExcelJS.Row[] = [];
    for (const [section, content] of rows) {
        const r = ws.addRow({ section, content });
        r.getCell(1).font = { bold: true };
        r.alignment = { readingOrder: "rtl", vertical: "top", wrapText: true };
        r.height = content.length > 100 ? 80 : 20;
        dataRows.push(r);
    }
    styleCells(dataRows);

    // Disclaimer
    ws.addRow([]);
    const discRow = ws.addRow({ section: "تنبيه مهم", content: "التحليل الآلي استشاري فقط ولا يُعدّ قراراً رسمياً. يجب أن يراجعه مشغل بشري قبل اتخاذ أي إجراء." });
    discRow.getCell(1).font = { bold: true, color: { argb: "FFB45309" } };
    discRow.getCell(2).font = { italic: true, color: { argb: "FFB45309" } };
    discRow.alignment = { readingOrder: "rtl", vertical: "top", wrapText: true };

    addFooter(ws, actor, ws.rowCount);
}

// ── Main export function ───────────────────────────────────────────────────────

/**
 * Build a complete incident Excel workbook.
 * Returns a Buffer ready to send as HTTP response.
 *
 * This function:
 *  - Never reads from DB directly (caller provides data)
 *  - Strips no data itself (caller must not include PII in reports array)
 *  - Adds RTL, Arabic-safe formatting, and a confidentiality footer
 */
export async function buildIncidentExcel(
    incident: IncidentRow,
    reports: ReportRow[],
    actor: ExportActor,
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Crisis-Sense Intelligence Platform";
    wb.created = new Date();
    wb.modified = new Date();
    wb.properties.date1904 = false;

    // Workbook-level document properties (invisible metadata watermark)
    wb.calcProperties.fullCalcOnLoad = false;

    buildSummarySheet(wb, incident, actor);
    buildReportsSheet(wb, reports, actor);
    buildAiSheet(wb, incident, actor);

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
}
