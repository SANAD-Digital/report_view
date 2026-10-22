# ADR-007: نقاط الدخول وسجل الـ hooks

- الحالة: مقبول (سجل الـ hooks محدَّث في 2026-10-22)
- التاريخ: 2026-09-30

## السياق
- لا يوجد hook للتقارير في Frappe (`frappe.get_hooks()` بلا مفتاح يحوي `report`، `frontend-query-report.md` §8). `page_js` يعمل لمستندات `Page` فقط (`core/doctype/page/page.py:194`)، و query-report صفحة قياسية `frappe.standard_pages["query-report"]` (`query_report.js:12`).
- `CLAUDE.md`: الربط عبر `hooks.py` فقط، وكل hook يُوثَّق في ADR.

## القرار
الـ hooks التي يسجّلها التطبيق. هذا الجدول هو السجل الوحيد لها ويطابق `report_view/hooks.py` (آخر مراجعة 2026-10-22). كل صف يشير إلى الـ ADR الذي يحمل السبب، وأي إضافة أو حذف في `hooks.py` يعدّل هذا الجدول في الـ commit نفسه. `tests/test_hooks.py` يتحقق من أن مرشّح `fixtures` يذكر كل سجل مشحون.

| المفتاح في `hooks.py` | القيمة | السبب | القرار |
|---|---|---|---|
| `required_apps` | `["erpnext"]` | خيارات الطباعة وعنوان ملف Excel تقرأ `Company` من ERPNext، والإعدادات والرؤوس المشحونة لتقارير المحاسبة في ERPNext. بلا ERPNext لا يثبت التطبيق بدل أن يفشل لاحقاً | هذا الـ ADR (2026-10-22) |
| `app_include_js` | `["report_view_entry.bundle.js"]` | زر «الانتقال إلى العرض المتقدم» (`__("Go to Advanced View")`) في صفحة query-report، ينقل فلاتر الصفحة الحالية عبر `frappe.route_options`. ملف صغير بلا مكتبات يستمع لـ `frappe.router.on("change")`، وإذا كان المسار `query-report/<name>` يطلب `report_view.api.get_entry_state` (مخزّن مؤقتاً في الجلسة) ويضيف زراً بـ `frappe.query_report.page.add_inner_button` (يمنع التكرار بـ `data-label`، `ui/page.js:622-660`) ويعيد إضافته بعد كل `load_report` لأن `clear_inner_toolbar` يُستدعى فيه (`query_report.js:163`) | هذا الـ ADR (المرحلة 6، قُدّم بطلب صاحب المشروع في 2026-10-05) |
| `app_include_css` | `["/assets/report_view/css/rv_fonts.css"]` | قواعد `@font-face` لمكتبة الخطوط المشحونة؛ ملف الخط نفسه لا يُحمَّل إلا حين تُستعمل عائلته. CSS الصفحة نفسها يبقى مع bundle الصفحة | ADR-018 |
| `doctype_js` | `{"Letter Head": "public/js/letter_head_form.js", "Print Format": "public/js/print_format_form.js"}` | زر «تصميم بالمنشئ» في نموذج Letter Head؛ وحقول قالب Custom في نموذج Print Format | ADR-018، ADR-019 |
| `pdf_body_html` | `report_view.core.letterhead.pdf_body_html` | ورق الشركة المبني بالمنشئ يحتاج هوامش الصفحة التي يكرره بها wkhtmltopdf. يستدعي الـ hook السابق (Frappe أو تطبيق مثبّت قبلنا) ويعيد ما يعيده لكل ما عداه. hook يفوز فيه آخر تطبيق مثبّت (`frappe.get_hooks("pdf_body_html")[-1]`): تطبيق يعرّفه بعدنا يعطّله، فـ `after_install` و `after_migrate` يسجّلان تحذيراً حينها (`check_pdf_body_html_hook`) | ADR-018، ADR-016 (تعديل 2026-10-22) |
| `jinja.methods` | `["report_view.core.printing.report_view_signature"]` | `{{ report_view_signature("Name", doc) }}` في قالب طباعة أي مستند | ADR-015 |
| `fixtures` | Print Heading (5) و Print Signature (13) بالاسم، و Property Setter `Print Format-print_format_for-options`، و Print Format `Report View Table` | الرؤوس والتواقيع القياسية؛ خيار مصدر الطباعة Custom وقالبه الجدولي. سجل عدّله المستخدم يبقى كما عدّله (`modified` أحدث من الملف) | ADR-015، ADR-017، ADR-019 |
| `after_install` | `report_view.install.after_install` | تثبيت Chromium الخاص بالتطبيق لملفات PDF في `<bench>/chromium-rv` إذا غاب: في الحال، 300 ث على الأكثر، بعد فحص الاتصال (لا يُفشل التثبيت)؛ ثم فحص `pdf_body_html` | ADR-016 (تعديل 2026-10-22) |
| `after_migrate` | `report_view.install.after_migrate` | إن غاب Chromium أو تغيّر إصداره: يضع تثبيته على طابور `long` (وظيفة واحدة للـ bench، قفل ونتيجة في `<bench>/tmp`) ولا ينتظره أبداً؛ ثم فحص `pdf_body_html` | ADR-016 (تعديل 2026-10-22) |
| `permission_query_conditions` | `{"Print Preset": "report_view.core.print_presets.permission_query_conditions"}` | القوائم = الإعدادات العامة + الخاصة بالمستخدم نفسه | ADR-020 |
| `has_permission` | `{"Print Preset": "report_view.core.print_presets.has_permission"}` | الخاص لا يراه ولا يعدّله إلا صاحبه، حتى System Manager (CLAUDE.md) | ADR-020 |
| `extend_bootinfo` | `report_view.core.settings.boot_session` | أين يفتح طباعة Custom افتراضياً يجب أن يُعرف عند الضغطة نفسها (المتصفح يمنع تبويباً يُفتح بعد طلب) | ADR-019 |
| `doc_events` | `Print Format.before_validate` = `report_view.core.custom_print.before_validate_print_format` | قالب Custom هو HTML و CSS فقط (`custom_format=1`، `standard="No"`) | ADR-019 |
| `doc_events` | `Letter Head.before_insert` = `report_view.core.letterhead.keep_builder_source` | ورق شركة يدرجه المنشئ يبقى HTML (Frappe يجعل كل ورق جديد صورة) | ADR-018 |
| `doc_events` | `Letter Head.on_trash` = `report_view.core.letterhead.delete_layout` | تخطيط المنشئ (`Letter Head Layout`) يُحذف مع ورقه، وإلا تعذّر حذف الورق | ADR-018 |
| `scheduler_events.hourly` | `report_view.core.export.jobs.cleanup` | ملفات تصدير Excel في الخلفية التي لم تُنزَّل تُحذف بعد ساعة (`private/rv_xlsx`). الملف خاص بصاحبه ويُحذف عند تنزيله؛ هذا لما لم يُنزَّل | هذا الـ ADR (2026-10-22؛ الآلية في `docs/architecture.md` §2.4) |
| `scheduler_events.hourly` | `report_view.core.pdf.cleanup_stale` | عمليات Chromium وملفات تعريفها التي تركها عامل قُتل، وملفات وظائف PDF الأقدم من ساعة | ADR-016 |
| `report_view_include_js` (مفتاح خاص بنا يقرؤه التطبيق من التطبيقات الأخرى، لا نعرّفه نحن) | قائمة bundles من أي تطبيق | يسمح للتطبيقات الأخرى بتسجيل `report_view.register` لتقاريرها؛ يُقرأ في `get_meta` ويُحمَّل بـ `frappe.require`. لا تطبيق على الـ bench يعرّفه حتى الآن | ADR-003 |

**لم يُبنَ:** الـ hooks التي خطط لها هذا الـ ADR لـ `Report View Saved View` (`permission_query_conditions` و `has_permission`، المرحلة 4) لم تُسجَّل لأن الـ DocType نفسه لم يُبنَ (ADR-010). و `after_install` كان مخططاً لتحميل الإعدادات الافتراضية؛ الإعدادات تُقرأ من `report_view/defaults/*.json` مباشرة (`core/settings.py`) فلا تحتاجه، وصار لتثبيت Chromium (ADR-016).

## العواقب
- `report_view_entry.bundle.js` يُحمَّل في كل صفحة Desk. حجمه المستهدف أقل من 3 KB مضغوطاً، ولا يستورد أي مكتبة.
- على `acc.dev` تطبيقان يعيدان تعريف `frappe.views.QueryReport` (`snd_accounting/public/js/snd_query_report.js:2`، `snd_print/public/js/report_extend.bundle.js:38`). الزر لا يعتمد على الصنف بل على `frappe.query_report.page` بعد التحميل، فيعمل مع النسختين. يُختبر في المرحلة 6.
- روابط مساحات العمل: رابط عادي من نوع URL إلى `/desk/report-view/<name>`، يضيفه المدير يدوياً أو يشحنه تطبيق.
