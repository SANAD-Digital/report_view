# ADR-023: سجل «Report View Settings» لكل تقرير: ما يظهر في التقرير، والـ JSON الذي يعتمد عليه شكله، وتفاصيل الصف

- الحالة: مقبول (طلب صاحب المشروع، 2026-10-28)
- التاريخ: 2026-10-28

## السياق
- إعدادات كل تقرير كانت في `report_view/defaults/<scrub(report)>.json` المشحون وحده (31 ملفاً: `report`, `enabled`, `report_settings`, `enrich_rules`, `filter_defs`, `balance_pairs`). تغييرها يحتاج نشراً جديداً للتطبيق، و `Report View Settings` في §5.2 كان «لم يُبنَ».
- طلب صاحب المشروع: DocType للـ JSON الذي يعتمد عليه شكل التقرير يتحكم به، والتحكم فيما يظهر: التجميع، البحث في الأعمدة، الفلاتر، أعمدة اللوحة الجانبية، وأنواع الرسوم. ثم أضاف: قسم «تفاصيل الصف» للزر في العمود الأول الذي يفتح الصف كاملاً.
- `filter_defs` حد أمان (ADR-021): لا يجوز أن يُضعفه سجل يعدّله أحد على الموقع.

## القرار
- **DocType `Report View Settings`** (الوحدة Report View، اسم السجل = اسم التقرير، `Link Report` فريد). الكتابة والقراءة لـ System Manager وحده: المتصفح يستلم النتيجة المدمجة عبر `get_meta.settings` فلا حاجة لقراءة السجل نفسه، فلا يرى مستخدم Desk ملاحظات المشرف ولا قالب تفاصيل الصف.
  - **عام**: `report`، `enabled` (مُطفأ: لا زر دخول في query-report و `get_entry_state` يعيد `show: false`، وصفحة Report View تقول «غير مفعّل»)، `description`.
  - **ما يظهر في التقرير**: حقول Check، كلها مفعّلة افتراضياً، فالتقرير بلا سجل أو بسجل جديد يبدو كما كان. أسماؤها هي مفاتيح كائن `features` الذي يقرؤه المتصفح (`state/features.js`): `grouping`, `subtotals`, `column_groups`, `pinning`, `density`, `quick_search`, `column_filters`, `set_filters`, `filters_panel`, `quick_filters`, `period_picker`, `side_panel`, `columns_panel`, `pivot`, `charts`, `pages`, `excel`.
  - **أنواع الرسوم**: Check لكل نوع من `CARD_TYPES` (`chart_bar` … `chart_kpi`، ثمانية) فتصل `features.chart_types`. لا جدول فرعي.
  - **العرض الافتراضي**: `default_mode` (جدول / تحليل محوري / رسوم / صفحات)، `default_group_by`، `default_hidden`، `default_pinned` (مفتاح عمود في كل سطر أو قائمة JSON). كلها مما تدعمه حالة العرض أصلاً (`default_state`)، لا ميزة جديدة في المحرك.
  - **تفاصيل الصف**: `row_details_enabled`، `row_details_container` (Drawer / Dialog)، `row_details_width` (Narrow / Medium / Wide)، `row_details_content` (Fields = كل أعمدة الصف بعناوينها وتنسيقها / HTML template / Print format)، `row_details_html` (Jinja)، `row_details_print_format` (Link، صيغة Custom فقط)، `row_details_document` و `row_details_doc_fields` (`{"doctype_field", "name_field"}`: عمودا نوع المستند واسمه، لعرض «فتح المستند» وطباعته القياسية). واجهة الزر يبنيها عمل لاحق؛ هذا القرار يبني الإعداد والعرض على الخادم.
  - **متقدم**: `report_settings`، `enrich_rules`، `balance_pairs`، `filter_defs` حقول JSON، وزرّا «Load from shipped defaults» (يملأ النموذج من الملف المشحون) و «Reset to shipped» (يفرّغ أجزاء JSON والعرض الافتراضي ويعيد المزايا كما في الملف)، و «Effective settings» (حقل HTML يعرض النتيجة المدمجة لقيم النموذج قبل الحفظ عبر `report_view.api.settings.preview`).
- **ترتيب الأولوية** (`core/settings.load_settings`)، من الأضعف: `empty_settings` < الملف المشحون < السجل، مفتاحاً بمفتاح:
  - `enabled` و `features` و `default_view` و `row_details`: السجل إن وُجد.
  - `report_settings`: دمج كائنين، مفاتيح السجل تغلب.
  - `enrich_rules` (بمفتاح `source_column` + `link_doctype`) و `balance_pairs` (بمفتاح `label`): قائمتان تُدمجان؛ عنصر السجل يحلّ محل نظيره ويُضاف الجديد. حقل فارغ = القيمة المشحونة كما هي.
  - **`filter_defs`: المشحون يغلب دائماً لاسمه** (ADR-021). السجل يضيف تعريفات لأسماء أخرى فقط؛ `validate` يرفض تعريفاً مشحوناً معدّلاً، والمحمِّل يتجاهله حتى لو كُتب خارج `validate`.
  - المحمِّل والتحقق دالة واحدة (`parse_enrich_rules`، `parse_balance_pairs`، `parse_filter_defs`، `record_layer`) بوضع صارم عند الحفظ: ما كان المحمِّل سيسقطه يُرفض برسالة مترجمة (Link و MultiSelectList يسميان DocType موجوداً).
- **الذاكرة المؤقتة**: النتيجة المدمجة لكل تقرير في Redis (`report_view:report_settings`) مع `mtime` الملف المشحون (نشر جديد يبطلها). `on_update` و `on_trash` و `after_rename` تمسحها الآن وبعد `commit` أو `rollback` (قراءة بينهما من عامل آخر لا تبقى قديمة).
- **المتصفح** (`state/features.js`): `sanitize_features` يكمل الكائن (مفتاح مجهول يُسقط، غياب = مفعّل؛ لا نوع رسم = لا رسوم؛ لوحة جانبية بلا تبويب = لا لوحة). `server_config` يضع العرض الافتراضي للخادم فوق `register` (§5.3) ويُسقط افتراضياً مُطفأً. `restrict_state` يُطبَّق بعد قراءة الرابط وإعدادات المستخدم وبعد كل تغيير (`page.change`): رابط يطلب عرضاً مطفأً يفتح الافتراضي، ولا `pivot` ولا `charts` ولا تجميع ولا تثبيت ولا فلتر قيم ولا فلتر سريع مما أُطفئ، فلا يبني المحرك view لما أُطفئ. كل مزية مطفأة تخفي واجهتها كاملة: الزر، التبويب، اللوحة، بند القائمة، السحب للتجميع (لا اختصارات لوحة مفاتيح على مستوى الصفحة اليوم). `excel` يرفضه الخادم أيضاً (`RVNoExport`)؛ البقية عرض فقط، فليست صلاحيات.
- **أنواع الرسوم**: محرر البطاقة يعرض المسموح فقط، البطاقة الجديدة من أول نوع مسموح، البطاقات المحفوظة (رابط أو إعدادات المستخدم) من نوع مطفأ تُسقط عند الفتح، وبطاقات اللوحة الافتراضية تأخذ أقرب نوع مسموح (`chart_config.default_cards`).
- **تفاصيل الصف على الخادم** (`core/row_details`): `get_meta.settings.row_details` يحمل الإعداد فقط، لا القالب. `report_view.api.render_row_details(report_name, row, filters, columns)` (POST، 60 في الدقيقة) يبدأ بـ `guard_report` ثم يعرض القالب أو الصيغة بالصف. الصف من المتصفح: بيانات غير موثوقة، حدها 64 KB، تُطبع مُهرَّبة (`printing.escaped`)، ولا تمنح صلاحية قراءة أي شيء. القالب في بيئة القوالب المضمّنة نفسها (`custom_print.inline_env`: `ImmutableSandboxedEnvironment` بلا loader ولا globals، ورفض `.__`)، ويقرأ `row`, `columns`, `report`, `filters`, `_`, `format_value` فقط. الصيغة تمر بـ `guard_custom_format` (صلاحية `select` على Print Format) وتقرأ `data` = الصف. `validate` يتأكد أن القالب يُترجَم في الصندوق وأن الصيغة Custom.
- **نقاط الدخول**: بند «Report View settings» في قائمة ⋯ لصفحة Report View لمن يملك System Manager (يفتح السجل، أو سجلاً جديداً للتقرير يُملأ من الملف المشحون)، وقائمة الـ DocType.
- لا fixtures: السجلات بيانات الموقع، والملفات المشحونة تبقى الأساس وتُشحن مع التطبيق.

## العواقب
- يتحكم المشرف بشكل أي تقرير دون نشر، ولا يستطيع إضعاف فحص فلاتر Link (`test_shipped_filter_defs_cannot_be_removed_or_retyped`، `test_a_dropped_company_link_is_still_checked_with_a_record`).
- تقرير بلا سجل يبدو كما كان تماماً: كل المزايا مفعّلة (`tests/js/features.test.mjs`، `tests/visual/settings.spec.js` «everything on»).
- تغيير Python يصل الموقع الحي بعد إعادة تشغيل العمال.
- الاختبارات: `report_view/tests/test_report_view_settings.py` (الأولوية، التحقق، الحد الأمني، الذاكرة المؤقتة، الصلاحيات، صندوق تفاصيل الصف)، `tests/js/features.test.mjs` (المنظِّف، وتطابق أسماء المزايا وأنواع الرسوم بين DocType وبايثون والمتصفح)، `tests/visual/settings.spec.js` (كل مزية مطفأة تخفي واجهتها).
