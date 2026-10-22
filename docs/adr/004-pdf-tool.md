# ADR-004: أداة PDF والخط العربي

- الحالة: مستبدَل بـ ADR-016 (2026-10-12): ملفات PDF تُطبع بمحرك Chromium خاص بالتطبيق على الخادم، و `Report View Settings.pdf_generator` لم يُبنَ (لا DocType بهذا الاسم). يبقى هذا الملف سجلاً لتجربة المرحلة 1
- التاريخ: 2026-09-30

## السياق
- تجربة المرحلة 1 (`docs/research/experiments.md` §1): جدول عربي بأرقام ومجاميع طُبع بنجاح بالمحركين:
  - wkhtmltopdf 0.12.6.1 عبر `frappe.utils.pdf.get_pdf(html)` (`frappe/utils/pdf.py:106-151`): 0.28 ث دافئ.
  - chrome عبر `get_chrome_pdf(..., pdf_generator="chrome")` (`pdf.py:167-186`): 0.34 ث دافئ، 1.7 ث بارد، يحتاج Chromium محلياً وإلا يحمّله Frappe من الإنترنت وقت الطلب (`print_utils.py:196-229`).
- الخط العربي الوحيد على الخادم هو DejaVu Sans؛ خط Print Settings (`effra`) غير مثبت.
- مشكلة bidi: التاريخ `2026-09-30` ينكسر عند التفاف السطر داخل RTL.

## الخيارات
1. wkhtmltopdf فقط.
2. chrome فقط.
3. wkhtmltopdf افتراضياً، و chrome خيار لكل تقرير في `Report View Settings.pdf_generator`.
الخط: (أ) الاعتماد على خطوط الخادم، (ب) تثبيت خط على كل خادم، (ج) شحن ملف خط داخل التطبيق وتضمينه.

## القرار
- الخيار 3.
- الخط (ج): التطبيق يشحن `report_view/public/fonts/NotoNaskhArabic-{Regular,Bold}.ttf` (رخصة SIL OFL 1.1) ويضمّنه في قالب الطباعة بـ `@font-face` بمسار `file://` مطلق للـ wkhtmltopdf (لأن `--disable-local-file-access` غير مفعّل في `get_pdf` الافتراضي؛ يُتحقق منه في المرحلة 6) وبـ base64 لـ chrome، مع DejaVu Sans بديلاً.
- كل تاريخ ورقم في القالب داخل `<bdi>` مع `white-space: nowrap`.

## العواقب
- ملف الخط ليس مكتبة برمجية، لكنه إضافة لم يذكرها الموجز: **يحتاج موافقة صاحب المشروع** (مذكور في `docs/progress/phase-2.md`).
- chrome يبقى معطّلاً افتراضياً حتى لا يحمّل الخادم Chromium من الإنترنت فجأة.
- قالب واحد بلا ميزات خاصة بمحرك واحد (لا flex متقدم؛ wkhtmltopdf يعتمد Qt WebKit قديماً).
