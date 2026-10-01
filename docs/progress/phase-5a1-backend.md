# المرحلة 5أ-1 — الخادم: مطابقة تصدير Excel لما يعرضه المتصفح

- الفرع: `phase-5a1-grid-basics` (بلا commit؛ التغييرات في شجرة العمل)
- التاريخ: 2026-10-01
- المرجع: قرار المنسّق بتفويض صاحب المشروع «ما على الشاشة = ما في Excel»؛ `docs/architecture.md` §4.2، §4.3، §7.1، §8أ.6؛ ADR-008 (تعديل 5أ-1)؛ ADR-012؛ `docs/progress/phase-5a1-frontend.md` §5 و §6
- كتبه وكيل `backend-dev`

## 1. ما تغيّر

| # | البند | الحالة | أين |
|---|---|---|---|
| 1 | الشجرة «كما هي» = صفوف التقرير نفسها، والإجمالي = الصف المرجعي لا مجموع الجذور؛ المجمَّعة والمفلترة من الأوراق | تم | `core/engine.py` (`_View.tree`، `_View.levels`، `reported_totals`) |
| 2 | الإجمالي العام في التقرير المسطح بلا فلتر ولا تجميع = الصف المرجعي كما أعاده التقرير | تم | `engine.apply`، `edge_rows` |
| 3 | الفرز وحده يبقي افتتاحي التقرير أولاً وختاميّه والمرجعي آخراً | تم | `engine.apply` (الشكل `flat`) |
| 4 | `group.subtotals`: رأس بلا أرقام + صف «إجمالي <المجموعة>»، أو رأس بأرقامه؛ المطوية بأرقامها دائماً | تم | `_View.add_group`، `_View.tree`، `export/xlsx.py` |
| 5 | الطي: `group.expanded` (مسارات) و `tree.expanded` (`__rid`) و `tree.depth`؛ الصفوف تُكتب كلها بمستويات outline والمطوية مخفية | تم | `engine.py` (`hidden` / `open` لكل صف)، `xlsx.py` (`outline_level`، `hidden`، `collapsed`) |
| 6 | أعمدة `columns.pinned.start` بعد عمود العنوان | تم | `engine.export_columns`، `pinned_columns`، `screen_columns` |
| 7 | عقد `expected` | تم وموثّق | `export/model.py` (`compare_expected`)، §4.2 (7)، §8أ.6 |
| 8 | رفض الفلاتر التي لا يطبّقها المتصفح | تم | `core/view_state.py` (`check_exportable`)، تُستدعى من `model.check_against_report` |
| 9 | الاختبارات، ruff، ملفات العينة | تم | §3، §4 |

لم يُضف أي دالة whitelisted ولا أي مكتبة. `export_xlsx` ما زالت تبدأ بـ `guard_report` ثم `guard_export`. لا `ignore_permissions`، ولا `set_user` في كود الإنتاج، ولا `db.sql` / `get_all`. المحرك دوال خالصة بلا قاعدة بيانات.

### 1.1 المحرك (`report_view/core/engine.py`، أُعيدت كتابته)
توأم لوحدات المتصفح، بدلالات Perspective التي قستها في node قبل الكتابة (لا من الذاكرة):

| القياس في Perspective 3.8.0 | النتيجة | ما فعله بايثون |
|---|---|---|
| `sum` على كل `null` | 0 | كذلك |
| `avg` مع `null` | يقسم على غير الفارغ؛ الكل `null` ⇒ `null` | كذلك (كان يقسم على عدد الصفوف) |
| `min` | يتجاهل `null` | كذلك |
| `high` (ما يستعمله المتصفح لـ `max`) | يعامل `null` صفراً: `[null, -5]` ⇒ 0، والكل `null` ⇒ 0 | **يتجاهل `null`** كما نصّت المهمة (انظر §6 بند ب) |
| `count` | عدد الصفوف، ومنها `null` | كذلك (كان يعدّ غير الفارغ) |
| `distinct count` | `null` قيمة | كذلك |
| الفرز | `null` آخراً تصاعدياً وأولاً تنازلياً | كذلك (كان آخراً دائماً) |
| `==` | مطابقة تامة حساسة للحالة | كذلك (كان غير حساس) |
| `contains` / `begins with` | تتجاهل حالة أحرف ASCII فقط (`é` لا تطابق `École`) | كذلك (كان `casefold` كاملاً) |
| `in []` | لا يمرّ شيء | كذلك |
| `not in` | يمرّر `null` | كذلك |
| `>=` / `<=` | لا يمرّ `null` | كذلك |

الدوال العامة (كلها بـ type hints):

| الدالة | الدور |
|---|---|
| `apply(nr, state, selection=None, layout_columns=None, lang=None) -> dict` | يعيد `{columns, label_key, rows, totals, total_source, row_count, layout_mode}`. الصف: `{kind, level, values, rid, label, group_key, group_value, count, open, hidden, bold}`، و `kind` نوع صف التقرير أو `parent` / `group` / `foot`. `layout_mode`: `tree` / `levels` / `group` / `flat`. `total_source`: `reference` / `frappe_total` / `engine` |
| `value_type(fieldtype)`، `typed_value(row, column)` | توأم `schema.perspective_type` و `schema.convert` (N8). تقبل كائنات `date` / `datetime` / `Decimal` القادمة من التشغيل داخل العملية |
| `effective_filters(filters, by_key)`، `filter_facts(facts, filters, by_key)` | توأم `to_filter`: الفلتر بلا قيمة ليس فلتراً |
| `collation_key(text, lang)` | تقريب `Intl.Collator` (§6 بند أ) |
| `aggregate_name(column, aggs)`، `aggregate(rows, column, agg)`، `totals_for(rows, columns, aggs)`، `reported_totals(row, columns, aggs)` | التجميع (`values[].agg` يغلب) وقراءة الإجمالي من صف التقرير |
| `screen_columns(nr, state)`، `pinned_columns(shown, state)`، `export_columns(nr, state, layout_columns, column_keys) -> (columns, label_key)` | ترتيب الأعمدة كالشاشة |
| `edge_rows(nr)` | توأم `report_rows.edge_rows` **بصيغته الجديدة** التي يكتبها وكيل الواجهة الآن (من ترتيب الأنواع، بلا اعتماد على الفواصل) |
| `tree_index(nr)`، `row_label(row, label_key, columns)` | توأم `tree_nodes.js` |

حُذفت `derived_value` (المفاتيح المشتقة من التاريخ): المتصفح لا يطبّقها، فصارت تُرفض في التصدير (§1.3).

### 1.2 الملف (`report_view/core/export/xlsx.py`)
- عنوان المجموعة `<القيمة> (العدد)`، والفارغة «غير محدد» (كان «(فارغ)»)، والتاريخ بتنسيق النظام. صف المجموع «إجمالي <المجموعة>» (`_("Total {0}")`، النص نفسه الذي تستعمله الشاشة).
- العناوين والإزاحة في عمود العنوان (أول عمود ظاهر على الشاشة)، لا في `tree.label_key`.
- لكل صف: `outline_level` = العمق (حتى 7)، و `hidden` للصف تحت مطوي، و `collapsed` على الصف المطوي نفسه. `summaryBelow = False` كما كان.
- صف الإجمالي العام: قيم `result["totals"]` (الصف المرجعي أو مجموع المحرك).
- `layout.include_subtotals = false`: لا صفوف مجموع، وصفوف المجموعات بلا أرقام.

### 1.3 التحقق (`report_view/core/view_state.py`، `export/model.py`)
- `validate`: `group.expanded` قائمة مسارات (قائمة غير فارغة من نص / رقم منتهٍ / منطقي / `null`، بطول ≤ 50)، و `tree.expanded` قائمة أعداد صحيحة غير سالبة؛ الحد 5,000 عنصر (حد المتصفح نفسه).
- `check_exportable(state, columns)` جديدة، للتصدير فقط (الحالة تبقى صالحة كعرض محفوظ). ترفض بـ `RVInvalidViewState` برسالة تسمّي الفلتر وتطلب حذفه:
  - البحث الحر `key: "*"`، و `not_contains`؛
  - فلتر لا يناسب نوع العمود (`text` / `set` لغير النص، `range` لغير الرقم، `date` لغير التاريخ)؛
  - `set` بلا `exclude` يجمع «فارغ» مع قيم؛
  - المفاتيح المشتقة من التاريخ في `sort` / `filters` / `group.by`.
- خمس رسائل جديدة ترجمتها في `report_view/locale/ar.po` (أُلحقت في آخر الملف).

**توسعة عن نص المهمة:** البند 8 سمّى `not_contains` والبحث الحر. أضفت الحالات الثلاث الأخرى لأنها من الصنف نفسه: المتصفح لا يطبّقها ويعرض تنبيهاً (أو يتجاهلها بصمت في المشتقة)، وتطبيقها في الخادم يجعل الملف غير الشاشة.

### 1.4 `report_view/api/__init__.py`
سطر واحد: `engine.apply(..., lang=frappe.local.lang)` لفرز النصوص بلغة المستخدم.

## 2. العقد المطلوب من وكيل الواجهة
مكتوب في `docs/architecture.md` §4.2 (4) و (7) و §8أ.6:
- `expected.row_count` = عدد الحقائق التي تمر من الفلاتر الفعّالة.
- `expected.totals` = الإجمالي المعروض: الصف المرجعي حين `post.total.source === "row"`، وصف Frappe حين `frappe_total`، ومجموع المحرك غير ذلك. الأرقام المنتهية فقط؛ المختلط والفارغ لا يُرسل.

التغييرات الجارية في شجرة العمل للواجهة (`perspective_engine.js`: `expected.totals = numeric_totals(totals.values, totals.mixed)`) **تطابق هذا العقد**: اختبار المطابقة يقرأ `expected` من محرك المتصفح الحالي ويقارنه بالخادم في 35 حالة.

تنبيه لوكيل الواجهة:
- نص التنبيه «الملف المصدَّر يطبّق هذه الفلاتر، فقد يُرفض التصدير» لم يعد صحيحاً: الخادم الآن يرفض ولا يطبّق.
- `bench compile-po-to-mo --app report_view --locale ar --force` لم أشغّله (ملف `ar.po` مشترك ويُعدَّل الآن)؛ الرسائل الخمس الجديدة تظهر بالعربية بعده.

## 3. الاختبارات

### 3.1 اختبار المطابقة مع محرك المتصفح (جديد)
- `report_view/tests/fixtures/screen/generate.mjs`: يشغّل وحدات الصفحة نفسها (`normalize.js`، `ReportSession.open`، `row_layout.build_layout`) على Perspective في node، ويكتب لكل (حالة مشتركة، حالة عرض) ما تعرضه الشاشة: الصفوف بترتيبها وأعماقها (صف تقرير بـ `__rid`، مجموعة بمجاميعها، صف مجموع)، والصفوف المثبّتة، والإجمالي ومصدره، و `expected`، وترتيب الأعمدة.
- `report_view/tests/fixtures/screen/cases.json`: 35 حالة على 8 حالات مشتركة (منها الأربع المطلوبة).
- `test_engine.TestEngineMatchesBrowser`: محرك بايثون يطابقها صفاً بصف (النوع، العمق، `__rid`، الفتح والطي، العدّاد، قيمة المجموعة، مجاميع كل عمود، الإجمالي، `row_count`، `expected.totals`، مصدر الإجمالي، ترتيب الأعمدة).
- **النتيجة: 35 من 35**، وأُعيد التوليد قبل آخر تشغيل. يُعاد التوليد بعد أي تغيير في محرك المتصفح: `node report_view/tests/fixtures/screen/generate.mjs`.

الحالات تغطي: الشجرة بعمق افتراضي وعمق 1 و 0 وقائمة `tree.expanded`؛ الشجرة المفلترة (مفتوحة، مطوية بقائمة، بلا مجاميع)؛ فلتر بلا قيمة؛ التجميع بمستوى ومستويين وبمسارات وب `none` وبمفتاح تاريخ وبترتيب تنازلي؛ `values[].agg` (avg، max، min، count، count_distinct)؛ الفرز الرقمي والنصي والمتعدد؛ فلاتر set / exclude / range / date / text؛ الأعمدة المثبّتة والمخفية؛ GL الموحّد و«حسب الحساب» و AR حسب الطرف بلا فلتر وبفرز وبتجميع؛ العملات المختلطة؛ صف مجموع Frappe؛ شجرة برؤوس مجموعات (Employee Leave Balance).

### 3.2 اختبارات لكل بند
| البند | الاختبار | الحالة المشتركة |
|---|---|---|
| 1 | `test_tree_as_is_is_the_report_itself`، `test_tree_total_is_the_reference_row_not_a_sum`، `test_tree_filtered_and_grouped_views_come_from_the_leaves`، `test_tree_filter_keeps_ancestors` | `trial_balance_fy2026` |
| 2 | `test_flat_total_is_the_reference_row_as_reported`، `test_flat_total_with_filter_or_group_is_the_engine_sum`، `test_export.test_general_ledger_rows_and_total` | `general_ledger_consolidated`، `general_ledger_by_account` |
| 3 | `test_sort_alone_keeps_opening_first_and_closing_last`، `test_rows_of_the_reports_own_groups` | الثلاث غير الشجرية |
| 4 | `test_group_subtotals`، `test_export.test_group_fold_and_subtotals`، `test_export.test_group_export` | `accounts_receivable_group_by_party`، وتشغيل حي لميزان المراجعة |
| 5 | `test_group_fold_is_hidden_not_removed`، `test_tree_fold`، `test_export.test_tree_fold_is_written_as_outline`، `test_export.test_fold_lists_are_validated`، `test_export.test_pinned_columns_and_group_rows_in_the_sheet` | AR حسب الطرف، ميزان المراجعة |
| 6 | `test_pinned_columns_follow_the_label_column`، `test_column_order_and_hidden`، `test_export.test_pinned_columns_and_group_rows_in_the_sheet` | AR حسب الطرف |
| 7 | `test_export.test_expected_is_what_the_screen_shows`، `test_export.test_mismatch_rejected`، `test_null_semantics_of_aggregates` | تشغيل حي |
| 8 | `test_export.test_filters_the_screen_does_not_apply_are_refused` (7 فلاتر عبر `export_xlsx`، ومفتاحان مشتقان، وأن الحالة تبقى صالحة في `validate`) | تشغيل حي، GL |
| دلالات | `test_sort_puts_nulls_last_ascending_first_descending`، `test_text_filters_as_perspective`، `test_collation_key`، `test_typed_values`، `test_mixed_currency_and_percent_avg`، `test_frappe_total_row_matches_engine_total` | |

`export_xlsx` لها اختبار مستخدم مسموح (`test_allowed_user_rtl_workbook`) ومرفوض (`test_denied_user`، `test_user_without_export_rejected`)، بلا تغيير.

### 3.3 المخرج
```
cd /home/snd/frappe-bench && bench --site acc.dev.sanad.digital run-tests --app report_view

Running 26 unit tests for report_view
Ran 26 tests in 0.686s
OK
Running 44 integration tests for report_view
Ran 44 tests in 10.173s
OK
```
70 اختباراً (كانت 37)، كلها ناجحة. الاختبارات تعمل داخل معاملة تُلغى؛ لم يُكتب شيء في الموقع.

```
env/bin/ruff check apps/report_view/report_view      → All checks passed!
env/bin/ruff format --check apps/report_view/report_view → 31 files already formatted
```

## 4. ملفات العينة (`docs/research/artifacts/`)
وُلّدت من الحالات المشتركة بسكربت للقراءة فقط (`xlsx.build` نفسه، لغة `ar`)، وفتحتها بـ openpyxl وراجعت الصفوف:

| الملف | الحالة | ما فيه |
|---|---|---|
| `phase5a1-trial-balance-tree-ar.xlsx` | ميزان المراجعة، شجرة بعمق 2 | 15 أباً و16 ورقة و9 صفوف مجموع؛ 11 صفاً مخفياً تحت آباء مطوية (`collapsed`) تحمل أرقامها؛ الآباء المفتوحة بلا أرقام وبعدها «إجمالي …»؛ الإجمالي 30,303,624 = الصف المرجعي |
| `phase5a1-accounts-receivable-group-subtotals-folded-ar.xlsx` | AR حسب الطرف، تجميع بالطرف مع مجاميع فرعية، ومجموعة واحدة مطوية، وعمودان مثبّتان | 6 مجموعات، 5 صفوف مجموع، 54 صفاً مخفياً تحت المجموعة المطوية؛ الطرف ورقم السند بعد عمود التاريخ |
| `phase5a1-general-ledger-opening-closing-ar.xlsx` | GL موحّد بلا فلتر | افتتاحي، 47 حقيقة، ختامي، ثم الإجمالي = الصف المرجعي (`balance` = 0) |
| `phase5a1-general-ledger-by-account-sorted-ar.xlsx` | GL «حسب الحساب» بفرز | افتتاحي التقرير، 48 حقيقة مفروزة، ختامي التقرير، الإجمالي المرجعي |

## 5. الشاشة مقابل Excel بعد التغيير (بنود §6 في تقرير الواجهة)

| # | الحالة | الشاشة | Excel الآن | النتيجة |
|---|---|---|---|---|
| 1 | GL موحّد، بلا فلتر ولا فرز | افتتاحي، 47 حقيقة، ختامي، الإجمالي العام | الترتيب نفسه | مطابق |
| 2 | `balance` في صف الإجمالي العام (GL) | قيمة الصف المرجعي (0) | قيمة الصف المرجعي (0) | **مطابق** (كان مجموع الأرصدة المتراكمة) |
| 3 | صفوف مجموعات التقرير نفسه بين الحقائق | الواجهة الجارية تعرضها في أماكنها (الشكل `report`) بلا فلتر ولا تجميع ولا فرز، وتخفيها مع أيٍّ منها بتنبيه | في أماكنها بلا فلتر ولا تجميع ولا فرز؛ تُحذف مع أيٍّ منها | **مطابق** مع الواجهة الجارية (35 من 35). مع نسخة الواجهة في آخر commit (لا تعرضها) يبقى الفرق القديم |
| 4 | فرز فقط | الافتتاحي والختامي مثبّتان، والإجمالي المرجعي | افتتاحي التقرير أولاً، الحقائق مفروزة، ختاميّه، ثم الإجمالي المرجعي | **مطابق** |
| 5 | صفوف المجموع الفرعي | رأس مفتوح بلا أرقام + صف «إجمالي» بعد الأبناء | كذلك | **مطابق** |
| 6 | `group.subtotals = false` | رؤوس المجموعات تعرض أرقامها | كذلك، ولا صف مجموع | **مطابق** |
| 7 | الطي (`group.expanded`، `tree.expanded`، `tree.depth`) | الصفوف المطوية غير ظاهرة | مكتوبة ومخفية، والمطوي `collapsed` | **مطابق** في الحالة الأولى؛ Excel يحتفظ بالصفوف ليفتحها المستخدم |
| 8 | الأعمدة المثبّتة | بعد عمود العنوان | بعد عمود العنوان | **مطابق** |
| 9 | الفلاتر غير المدعومة | لا تُطبَّق، مع تنبيه | التصدير يُرفض بـ `RVInvalidViewState` برسالة تسمّي الفلتر | لا ملف يخالف الشاشة (كان `RVExportMismatch` بلا سبب واضح) |

وأُصلح ما لم يكن في الجدول: عمق الشجرة كان ينقص مستوى عن الشاشة (`level >= depth` بدل `depth < D`)، وبلا `tree.depth` كان الخادم يفتح كل شيء والشاشة تفتح إلى `initial_depth`؛ المجموعات كانت بترتيب أول ظهور والشاشة بترتيب المفتاح؛ آباء الشجرة المفلترة كانت تحمل قيم التقرير والشاشة تجمع الأوراق المطابقة؛ الأعمدة غير المذكورة في `columns.order` كانت تُحذف والشاشة تضعها آخراً؛ `values[].agg` كان مُهملاً؛ فلتر التاريخ كان يقبل النصوص فقط، والتشغيل داخل العملية قد يعيد كائنات `date` (الحالات المشتركة JSON فلا تكشفه؛ من قراءة الكود، ولم أقسه حياً)، فصار يقبل الشكلين.

## 6. ما بقي مختلفاً ولماذا

| | الفرق | السبب | الأثر |
|---|---|---|---|
| أ | ترتيب النصوص تقريب لـ `Intl.Collator` | لا ICU في الخادم، و PyICU مكتبة جديدة | ترتيب الصفوف والمجموعات قد يختلف في أحرف غير معتادة (ي / ى، رموز). لا أثر على أي رقم. في الحالات الـ 35 (عربي ولاتيني وأرقام) الترتيب مطابق |
| ب | `max` عند وجود `null` | المتصفح يستعمل `high` في Perspective، وهو يعامل `null` صفراً (`[null, -5]` ⇒ 0). المهمة نصّت أن `max` يتجاهل `null`، فالخادم يعيد −5 | عمود بتجميع `max` فيه خلايا فارغة وكل قيمه سالبة ⇒ `RVExportMismatch` (يُرفض الملف، لا يُكتب خطأ). **يحتاج قراراً:** إصلاح المتصفح أو مجاراته |
| ج | عنوان صف المجموع في الشجرة | الشاشة تكتب «إجمالي <اسم الحساب>» من `register.tree.name_key` (إعداد متصفح فقط)؛ الخادم يكتب «إجمالي <قيمة عمود العنوان>» | نص العنوان فقط |
| د | عدّاد الأوراق بجوار الأب في الشجرة | يظهر على الشاشة شارةً؛ لا يُكتب في Excel حتى لا تتغير قيمة خلية الحساب | زينة |
| هـ | الأعمدة المخفية التي يصدّرها التقرير (`export_hidden`) | تُكتب فقط حين لا يرسل المتصفح `layout.columns` (سلوك قائم؛ المتصفح يرسلها دائماً فلا تُكتب) | بلا تغيير عن السابق |
| و | الشاشة أضيق من 600px | التثبيت يُلغى بصرياً هناك؛ ترتيب الأعمدة نفسه فلا فرق في الملف | لا شيء |
| ز | تقرير شجري فيه مجاميع داخلية غير المرجعي (Balance Sheet: «Total Asset» …) | ليست في جدول العقد فلا تظهر على الشاشة، والخادم صار لا يكتبها (كان يكتبها) | مطابق للشاشة، لكنها معلومة تغيب عن الطرفين. **يحتاج قراراً** إن أُريد عرضها |
| ح | فلتر `datetime` بحدّ يوم | الخادم يقارن باليوم بتوقيت UTC للقيمة المحمّلة؛ لم أقس كيف يفسّر Perspective نص التاريخ في عمود `datetime` داخل المتصفح (المنطقة الزمنية) | غير مثبت؛ لا حالة مشتركة فيها عمود `Datetime` |
| ط | `scope: "selection"` | غير منفَّذ في المتصفح بعد (5ج)؛ الخادم يعامله كفلتر | لا مقابل على الشاشة للمقارنة |

## 7. ما لم يكتمل أو لم يُتحقق منه
- لم أفتح ملفات العينة في Excel أو LibreOffice: التحقق بـ openpyxl فقط (`outline_level`، `hidden`، `collapsed`، القيم). سلوك أزرار الطي في Excel نفسه غير مجرَّب.
- لم يُجرَّب التصدير من المتصفح على الموقع (لا حساب دخول)؛ المسار مختبر عبر `api.export_xlsx` بمستخدمي الاختبار.
- `cases.json` لقطة من محرك المتصفح **في شجرة العمل الحالية** (تعديلات وكيل الواجهة غير المودعة). إن تغيّر `edge_rows` أو `to_view_config` بعدها يجب إعادة التوليد، وقد يفشل اختبار المطابقة إلى أن يُحدَّث التوأم في `engine.py`.
- `.mo` العربي لم يُعَد بناؤه (§2).
- PDF (`export_pdf`) غير موجود بعد؛ سيقرأ ناتج `engine.apply` نفسه.
- `report_view/hooks.py` معدَّل في شجرة العمل وليس من عملي.

## 8. الانحرافات عن المعمارية (حُدّثت الوثيقة)
| الموضع | التغيير |
|---|---|
| §4.2 (4) | رفض ما لا يطبّقه المتصفح (`check_exportable`) |
| §4.2 (7)، §8أ.6 | عقد `expected` بدقة |
| §4.3 | أُعيدت كتابته: الأشكال الأربعة، مصدر الإجمالي، المجاميع الفرعية، الطي، ترتيب الأعمدة، دلالات التجميع والفلاتر والفرز، الاختبار المشترك. حُذف سطر الأبعاد المشتقة |
| §7.1 | شكل `group.expanded` و `tree.expanded` (كان `[rid_path]`) |
| §8أ.2 | سطر الفلاتر غير المدعومة |
| ADR-008 | تعديل 5أ-1: الصف المرجعي إجمالياً في المسطح، والشجرة في التصدير، ودلالة `avg` |

## 9. المطلوب من صاحب المشروع
- قرار في §6 بند ب (`max` مع الخلايا الفارغة).
- قرار في §6 بند ز (مجاميع التقارير المالية الداخلية في الشجرة).
- تأكيد توسعة البند 8 (§1.3): رفض فلاتر النوع غير المناسب و«فارغ مع قيم» والمفاتيح المشتقة، لا `not_contains` والبحث الحر وحدهما.
