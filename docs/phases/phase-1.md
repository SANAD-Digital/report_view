# المرحلة 1: فهم محرك التقارير في Frappe

**الوكلاء:** `frappe-researcher` (يمكن تشغيل أكثر من نسخة بالتوازي، واحدة لكل محور).
**قراءة فقط. لا كود في التطبيق.**

## المحور أ: الخادم ← `docs/research/frappe-report-engine.md`
- `frappe/desk/query_report.py`: `run`، `get_script`، `generate_report_result`، `get_prepared_report_result`، `add_total_row`، `export_query`، `get_filtered_data`، `has_match`، وكل ما تستدعيه.
- DocType `Report`: أنواع التقارير، `ref_doctype`، الأدوار، `is_standard`، `prepared_report`، `add_total_row`، `columns`، `filters`، `javascript`، `query`، و `is_permitted`.
- Prepared Report: متى يُفعَّل، وكيف يعمل في الخلفية، وكيف تُقرأ النتيجة، وما الحد الذي يُفعّله تلقائياً.
- كل أشكال الرد الممكنة: الأعمدة كقواميس أو نصوص "Label:Fieldtype/Options:Width"، والصفوف كقوائم أو قواميس، و `message`، و `chart`، و `report_summary`، و `skip_total_row`، وصفوف المجموع، والصفوف الفارغة، و `indent`.

## المحور ب: الصلاحيات ← `docs/research/permissions.md`
جدول لكل طبقة فحص: أين تحدث (ملف وسطر)، وما الذي تمنعه، وكيف نختبرها:
- أدوار التقرير
- صلاحية `report` على `ref_doctype`
- User Permissions وتطبيقها على صفوف النتيجة (وحدودها: أي أعمدة تُفحص وأيها لا)
- `can_export` وصلاحية `print`
- التقارير بلا `ref_doctype`
- ما يحدث عند استدعاء `run` مباشرة عبر API بمستخدم غير مصرّح

**تحقق عملي:** شغّل Trial Balance و General Ledger و Accounts Receivable بكل مستخدمي الاختبار، واكتب النتيجة الفعلية لكل واحد.

## المحور ج: الواجهة ← `docs/research/frontend-query-report.md`
- `frappe/public/js/frappe/views/reports/query_report.js` وما يرتبط به:
  - تحميل سكربت التقرير و `frappe.query_reports[name]`
  - الفلاتر: `get_query`، `on_change`، `depends_on`، `reqd`، القيم الافتراضية، والفلاتر المعتمدة على بعضها
  - `formatter` وما يعيده (HTML)، وإعدادات الشجرة (`tree`، `name_field`، `parent_field`، `initial_depth`)
  - الرسم، والملخص، واختيار الأعمدة، والتصدير، والطباعة، و `get_datatable_options`
- التنسيق: `frappe.format`، والعملة، والدقة، وإعدادات النظام، و `frappe.utils.is_rtl`.
- User Settings وكيف تحفظ صفحة التقارير تفضيلات المستخدم.
- التنقل عند الضغط: `route_options` و `set_route`.
- نظام bundles في هذا الإصدار، وتحميل bundle عند الطلب (`frappe.require`).

## المحور د: كتالوج التقارير ← `docs/research/report-catalog.md`
30 تقريراً قياسياً (حسابات، مخزون، مبيعات، مشتريات، موارد بشرية)، في جدول:
النوع | شكل الأعمدة | شكل الصفوف | شجري؟ | صف مجموع؟ | Prepared؟ | الفلاتر الإلزامية | formatter خاص؟ | إثراء مقترح | ملاحظات

## المحور هـ: تجارب حاسمة ← `docs/research/experiments.md`
1. **PDF عربي:** اطبع صفحة HTML فيها جدول عربي بأرقام ومجاميع عبر أداة PDF الموجودة. أرفق الملف الناتج. هل التشكيل سليم؟ هل الاتجاه صحيح؟
2. **Excel:** أنشئ ملفاً بـ openpyxl باتجاه RTL، ورؤوس مدمجة، ومستويات طي، وتنسيق أرقام. افتحه وتحقق.
3. **الحجم:** ما أكبر تقرير في الموقع؟ كم صفاً يرجع؟ كم زمن `run`؟

## المخرجات الختامية
- `docs/research/reuse-vs-build.md`: ماذا نعيد استخدامه من Frappe كما هو، وماذا نبنيه، ولماذا.
- `docs/research/risks.md`: المخاطر مرتبة حسب الخطورة، مع اقتراح لكل منها.

## شروط القبول
- [ ] الملفات السبعة موجودة
- [ ] كل استنتاج تقني مرفق بمسار ورقم سطر
- [ ] جدول الصلاحيات مبني على تجربة فعلية بالمستخدمين الخمسة
- [ ] الكتالوج يحتوي 30 تقريراً بكل الأعمدة المطلوبة
- [ ] نتيجة تجربة PDF العربي واضحة (نجح / فشل + الملف)
- [ ] قسم «أسئلة مفتوحة» في كل ملف

## المخرج
`docs/progress/phase-1.md` ثم توقف.
