# ADR-015: رأس الطباعة، ومستند «Print Signature»، وإعدادات Report View العامة

- الحالة: مقبول
- التاريخ: 2026-10-12

## السياق
- طلب صاحب المشروع (2026-10-12) ثلاثة أشياء في وضع «صفحات» (ADR-014):
  1. اختيار **رأس طباعة** (`Print Heading` في Frappe) يُرندر باسم التقرير وفلاتره، مع أزرار تحكم (هل يتكرر في كل الصفحات وغير ذلك).
  2. DocType باسم **Print Signature**: الاسم، معطّل، النوع (تقرير أو مستند)، المحتوى HTML أو جدول، حقل CSS، وشرح لاستخدام HTML و Jinja.
  3. **مستند إعدادات** فيه الإعدادات القياسية والثابتة.
- `Print Heading` في Frappe فيه حقلان فقط: `print_heading` (Data) و `description` (Small Text)، وصلاحية القراءة لدور `Desk User`.
- المعمارية (§5.2) خططت لـ `Report View Global Settings` (Single) ولم يُبنَ؛ وحد الصفوف (`DEFAULT_MAX_ROWS`) وحد صفحات الطباعة (`PRINT_MAX_PAGES`) كانا ثابتين في الكود، وإعدادات الطباعة الافتراضية ثابتة في `DEFAULT_SETTINGS`.

## القرار
- **رأس الطباعة**: عنوانه ووصفه قالبا Jinja يُرندران في الخادم (`api.render_print_heading`) بسياق `printing.report_context`: `title`، `report_name`، `filters.<f>.{label,value}`، `doc` (قيم الفلاتر)، `company`، `printed_by`، `printed_on`، `lang`. التقرير **لا يُشغَّل مرة ثانية**. الوصف النصي بلا وسوم تبقى أسطره (`<br>`). اللغة لغة الصفحات (`_lang`). في المتصفح: قسم خاص في اللوحة (الصفحات: كل الصفحات / الأولى فقط / الكل ما عدا الأولى، «بدلاً من عنوان التقرير»، الحجم، المحاذاة، الهوامش الأربعة، الخط تحته)، ويُرسم تحت الترويسة في القالب القياسي وقوالب التقرير.
- **Print Signature** (DocType في وحدة Report View، تسمية بحقل `signature_name`): `disabled`، `signature_for` (Report / Document) مع `report` أو `reference_doctype` (فارغ = للكل)، `content_type` (Table / HTML)، جدول `Print Signature Item` (عنوان الخانة، الشخص، المسمى الوظيفي، سطر التاريخ)، `html` (Jinja، يُتحقق من صحته عند الحفظ)، `css`، وحقل شرح يُبنى بـ JS بلغة المستخدم. نوع «جدول» يُرندر بقالب `templates/includes/print_signature.html` مع هروب القيم (`|e`).
  - **CSS** يُضمَّن داخل `.rv-signature{…}` (CSS nesting) فلا يصل إلى بقية الصفحة، ويُحذف منه أي `</style`.
  - **للتقارير**: `api.render_print_signature` (توقيع مفعّل، من نوع Report، لهذا التقرير أو للكل) يحل محل خانات التوقيع القياسية في الصفحة الأخيرة.
  - **للمستندات**: دالة Jinja `report_view_signature(name, doc)` عبر `hooks.jinja.methods` تُستدعى في قالب طباعة أي مستند. لا تعيد شيئاً لتوقيع معطّل أو من نوع آخر أو لنوع مستند مختلف أو لمن لا يقرأ التوقيع.
- **Report View Global Settings** (Single): الحدود الثابتة (`max_rows` ≤ 200,000 ويبقى تحت `System Settings.max_report_rows`؛ `print_max_pages` ≤ 2,000) والإعدادات القياسية للطباعة (الورق، الاتجاه أو تلقائي، الهوامش، الأسلوب، الترويسة، رأس الطباعة، التوقيع، صفحات الترويسة ورأس الطباعة والتذييل وارتفاعاتها، الترقيم، المحتوى). `get_print_options` يعيدها في `defaults` بمفاتيح إعدادات الصفحات، والمتصفح يتحقق منها بـ `sanitize_settings` كما يتحقق من إعدادات المستخدم. هي ما يبدأ به المستخدم الجديد وما يعود إليه زر «استعادة الافتراضي»؛ إعدادات المستخدم المحفوظة تبقى فوقها. مستند لم يُحفظ بعد يُقرأ من قيم التعريف الافتراضية فقط (لا من افتراضيات جلسة من فتحه).

## الصلاحيات
- `render_print_heading` و `render_print_signature`: `guard_report` ثم `guard_print` في أول سطرين، ثم القراءة بـ `frappe.get_list` (من لا يقرأ رؤوس الطباعة أو التواقيع لا يحصل على شيء). الرندرة بـ `frappe.render_template` (بيئة Frappe المعزولة).
- `Print Signature`: كتابة System Manager، قراءة `Desk User`. `Report View Global Settings`: كتابة System Manager، قراءة `Desk User`؛ يُقرأ في الخادم كإعدادات (كما يقرأ Frappe إعدادات النظام) لأنه لا يحمل بيانات مستخدمين.

## العواقب
- hook جديد: `jinja.methods` (`report_view.core.printing.report_view_signature`).
- hook `fixtures`: رؤوس طباعة وتواقيع قياسية تُشحن في `report_view/fixtures/` (خمسة رؤوس، وتسعة تواقيع للتقارير منها خمسة جداول وأربعة HTML، وتوقيع واحد للمستندات). تُزامَن مع `bench migrate`، والسجل الذي عدّله المستخدم يبقى كما عدّله (`modified` أحدث من الملف). أسماؤها ونصوصها بالإنجليزية وتُترجم بلغة الطباعة عبر `_()`، وقوالبها أمثلة موثقة بتعليقات `{# #}`.
- بيئة Jinja في Frappe لا تسمح بـ `str.format` (`UNSAFE_ATTRIBUTES`): القيم تُدخل في النص المترجم بـ `|replace("{0}", …)`، ومتاح `frappe.get_fullname` لا `frappe.utils.get_fullname`. أصناف CSS في القوالب ببادئة `rvs-` لأن الأسماء الشائعة (`.row`) تخص تنسيقات Desk.
- ثلاثة DocTypes جديدة: `Print Signature`، `Print Signature Item` (جدول)، `Report View Global Settings` (Single). تُثبَّت بـ `bench migrate` أو `reload-doc`.
- `core/settings.get_row_limit` يقرأ `max_rows` من الإعدادات العامة؛ `PRINT_MAX_PAGES` يبقى قيمة احتياطية في المتصفح.

## تعديل (2026-10-12): حقول Link في اللوحة
- قالب الطباعة والترويسة ورأس الطباعة والتوقيع واللغة صارت حقول Link (`frappe.ui.form.make_control`) بدل قوائم ثابتة: البحث عبر `search_link` بصلاحيات المستخدم وقيود الشركة، مع فلاتر: قوالب التقرير (`print_format_for = Report`، `report` ضمن `get_print_options.reports`، JS أو Jinja، غير معطّلة)، الترويسات غير المعطّلة، اللغات المفعّلة.
- التوقيع بدالة بحث خاصة `api.search_print_signatures` (شرط «لهذا التقرير أو للكل» لا يُكتب بفلاتر Link)، تبدأ بـ `guard_report` و `guard_print` وتقرأ بـ `frappe.get_list`. `Print Signature` صار `translated_doctype`: الاسم يظهر مترجماً، والبحث يطابق الاسم أو ترجمته.
- الفارغ هو الاختيار القياسي (قالب Report View، بلا ترويسة، بلا رأس، الخانات القياسية، لغة الجلسة).
- قوالب التقرير (Print Format) صارت تُختم بالتوقيع كالقالب القياسي.
