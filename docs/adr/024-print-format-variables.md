# ADR-024: متغيرات قالب الطباعة — اختيارات في صفحة الطباعة تتحكم في عرض القالب

- الحالة: مقبول
- التاريخ: 2026-10-28

## السياق
- طلب صاحب المشروع (2026-10-28): «في محرك الطباعة وقالب الطباعة: أضف إلى Print Format حقلاً نصياً يخزّن بيانات JSON، مخفياً، وزراً مخصصاً اسمه «إضافة متغيرات»؛ عند الضغط عليه تفتح نافذة فيها جدول متغيرات: الأعمدة التسمية واسم المتغير والنوع والقيمة الافتراضية؛ الأنواع Select وCheck وLink ورقم. تظهر هذه المتغيرات في صفحة الطباعة في قسم خاص بها؛ وعند تغيير قيمتها تُرسل البيانات عند الرندرة إلى قالب الطباعة لأنها تتحكم في طريقة عرض البيانات».
- القوالب ثلاثة أنواع (ADR-014/017/019): قالب مستند يرندره Frappe (`get_html_and_style`)، قالب تقرير (Jinja على الخادم أو JS في المتصفح)، وقالب مخصص (Custom). كلها تُفتح في صفحات Report View ومحركها نفسه.
- Frappe يرندر قالب المستند بنفسه؛ المكان الوحيد الذي يصل فيه تطبيق إلى سياق القالب دون تعديل Frappe هو hook `pdf_body_html` الذي يملكه التطبيق أصلاً (ADR-018).

## القرار
### الحقل
- **Custom Field** على Print Format: `rv_variables` (Code / JSON، مخفي، للقراءة فقط في النموذج)، مشحون في `fixtures/custom_field.json` (الاسم `Print Format-rv_variables`، الوحدة Report View) مع سطر في `fixtures` بـ `hooks.py`.
- التثبيت على acc.dev بلا migrate: `bench --site $SITE import-doc apps/report_view/report_view/fixtures/custom_field.json`. (على acc.dev يرفض Frappe الإدراج بسبب حقل مخصص قديم مكرر لتطبيق آخر، `Print Format-preview_image`؛ أُدرج السجل نفسه بـ `flags.ignore_validate` مرة واحدة.)
- **المخطط**: قائمة، كل عنصر `{label, fieldname, fieldtype, options, default, description?}`:
  - `fieldname`: `[a-z][a-z0-9_]{0,39}`، فريد، وليس اسماً محجوزاً في سياق القالب: `doc`، `data`، `rows`، `filters`، `columns`، `title`، `company`، `lang`، `frappe`، `_`، `variables`.
  - `fieldtype`: `Select` | `Check` | `Link` | `Float` | `Int`.
  - `options`: Select = الخيارات سطراً سطراً (≤ 100، بلا تكرار)؛ Link = اسم DocType موجود (ليس جدولاً فرعياً).
  - `default`: من نوع المتغير (Check = 0/1، الأرقام أرقام، Select أحد خياراته).
  - 30 متغيراً على الأكثر.
- **الفحص على الخادم**: `doc_events` لـ Print Format صارت `before_validate` قائمة: فحص القالب المخصص (ADR-019) ثم `report_view.core.print_variables.validate_print_format`: JSON صالح يطابق المخطط، وإلا رسالة مترجمة تسمّي المتغير. يُخزَّن بعد التطبيع.

### النموذج
- زر «إضافة متغيرات» (`__("Add variables")`) في **كل** نموذج Print Format (قوالب المستندات والتقارير والمخصصة) من `print_format_form.js`. يفتح `frappe.ui.Dialog` فيه جدول (التسمية، اسم المتغير، النوع، الخيارات، القيمة الافتراضية، الوصف) معبأ من الحقل، وسطر مساعدة: `{{ variables.show_details }}`.
- «تطبيق» يفحص الصفوف بالقواعد نفسها في المتصفح (`report_view/print_variables.js`، يعرضه `report_view_entry.bundle.js` باسم `report_view.print_variables`) ثم `frm.set_value` ويُعلَّم النموذج متغيراً؛ الحفظ يفحصها الخادم مرة أخرى. صف بلا اسم يأخذ اسماً من تسميته إن أمكن.

### صفحة الطباعة
- قسم «المتغيرات» أداة خاصة في الشريط (مجموعة «المحتوى» بعد «القالب واللغة»)، بأسلوب القوائم نفسه (ورقة من الأسفل على الهاتف)، يظهر فقط عندما يكون للقالب المختار (أو قالب المستند الافتراضي، أو قالب المتصل في الوضع المخصص) متغيرات.
- عنصر لكل متغير: Select = قائمة، Check = مفتاح، Link = حقل Link من Frappe (بحثه `search_link` وصلاحيات المستخدم)، Float/Int = حقل رقم. القيمة الأولى: المحفوظة إن بقيت صالحة، وإلا الافتراضية.
- تغيير قيمة يعيد رندرة **القالب فقط** بعد سكون قصير (250 ms، والأرقام 400 ms): الترويسة ورأس الطباعة والتوقيع والترجمات من ذاكرتها (`Lru`)، ومفتاح ذاكرة القالب يضم القيم.
- القيم تُحفظ مع إعدادات المستخدم (المفتاح `variables`: `{القالب: {المتغير: القيمة}}`) وتدخل الإعدادات المسبقة (ADR-020) مفتاحاً خاصاً بالهدف مثل `template` (`TARGET_KEYS`)؛ `SETTINGS_KEYS` في `core/print_presets.py` يقبلها بقيم بسيطة فقط.
- خيارات الصفحة الثلاثة (`get_print_options`، `get_doc_print_options`، `custom_print.get_options`) تعيد `print_format_variables`: `{القالب: التعريفات}` للقوالب التي لها متغيرات.

### الخادم
- `print_variables.resolve(pf, variables)`: كل متغير للقالب = القيمة المرسلة بعد فحصها، وإلا الافتراضية. مفتاح مجهول يُسقط؛ Check → 0/1؛ Int/Float → رقم (|n| ≤ 10¹²، Int عدد صحيح)؛ Select → أحد خياراته وإلا رفض؛ Link → سجل موجود **ويملك المستخدم قراءته** (`frappe.has_permission(doctype, "read", doc=name)`) وإلا `PermissionError`. القيمة الافتراضية من نوع Link لا يقرؤها المستخدم تصبح فارغة. النصوص `printing.Text` (تُطبع مهرّبة).
- مسارات الرندرة كلها تقبل `variables` (JSON):
  - قالب المستند: `render_doc_print(..., variables)` يضع القيم المفحوصة في `frappe.local` أثناء `get_html_and_style`، و`pdf_body_html` (core/letterhead.py) يضيفها إلى سياق القالب `variables`. طباعة Frappe الأصلية وPDF الخاص به يحصلان على القيم الافتراضية من الـ hook نفسه، فلا ينكسر قالب يقرأ `variables`.
  - قالب التقرير Jinja: `render_print_format(..., variables)`؛ قالب JS يقرأ `variables` في المتصفح من القيم نفسها.
  - القالب المخصص: `custom_print.render(..., variables)`؛ القالب المرسل (inline) بلا Print Format فلا متغيرات له.
  - PDF الخادم يأخذ HTML المرندر مسبقاً: لا تغيير.

## العواقب
- Custom Field وhook موسَّع (`doc_events` قائمة) ولا مكتبة جديدة. لا migrate: السجل يُستورد بـ import-doc.
- تغيير بايثون يصل إلى الموقع الحي بعد إعادة تشغيل الخادم.
- القالب الذي يقرأ `variables` يعمل في كل مكان (الصفحات، طباعة Frappe، PDF)؛ القيم من المتصفح لا تتجاوز صلاحيات المستخدم (Link) ولا تُطبع HTML.
- الاختبارات: `report_view/tests/test_print_variables.py` (المخطط، التحويل، رفض Link، السياق بالقيم الافتراضية، كل مسار)، `tests/js/print_variables.test.mjs`، والمرئي في `tests/visual/print_engine.spec.js`، وعلى الموقع `tests/site/variables.cjs`.
