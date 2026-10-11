# ديون تقنية — جانب الخادم (جولة تنظيف)

- الفرع: `phase-5a2-design-parity`
- التاريخ: 2026-10-11
- المرجع: `CLAUDE.md` (قواعد الصلاحيات)، `docs/architecture.md` §2–§4 و §8أ.6، ADR-001، ADR-009، **ADR-013 (جديد)**، `docs/progress/phase-5a2-wave1.md` (دين «التصدير مع فلتر سريع يُرفض»)
- كتبه وكيل `backend-dev`. لم يُمسّ أي ملف JS/CSS/اختبارات Playwright.

## 1. ما تغيّر

| # | البند | الحالة | أين | commit |
|---|---|---|---|---|
| 1 | الاختبار `test_row_count_excludes_frappe_total` كان يفشل لأن «Accounts Receivable» صار `prepared_report=1` على `acc.dev` (Frappe يقلبه تلقائياً بعد تشغيل بطيء، ADR-009) فجاء الرد `prepared_missing`. الاختبار يجرّب الآن «Accounts Payable» ثم «Accounts Receivable» ويأخذ أول رد `ok` بصفوف، ويبقى يفحص الشيء نفسه (`add_total_row`، آخر صف قائمة، `row_count = len - 1`) وزاد فحصاً أن أول صف قاموس. وأُضيف `test_count_rows_rule` يفحص قاعدة N2.1 نفسها على صفوف مصطنعة بلا اعتماد على بيانات الموقع | تم | `tests/test_api_run.py`، `tests/utils.py` (`AP_FILTERS`، `TOTAL_ROW_REPORTS`) | `5a3a862` |
| 2 | `limit_page_length` المهمل في Frappe 16 ⇒ `limit` في الاستدعاء الوحيد عندنا (`api.enrich`). `limit=0` = بلا حد في `frappe/database/query.py:296` | تم | `api/__init__.py` | `2079bd1` |
| 3 | **التصدير مع الفلاتر السريعة**: قواعد تعابير مغلقة في الخادم (ADR-013). النموذج يحمل `quick_filters: [{id, expression}]`، و `core/expressions.py` يحلّل ويقيّم بدلالات Perspective المقيسة، و `engine.apply(..., quick_filters=)` يضيّق الحقائق بالنشطة كفلتر متصفح، و `export/model.py` يتحقق (الشكل، القواعد، تغطية المعرّفات النشطة، وجود الأعمدة ونوعها الرقمي) | تم في الخادم؛ **المتصفح معلّق** | `core/expressions.py` (جديد)، `core/export/model.py`، `core/engine.py`، `api/__init__.py`، `core/view_state.py` (docstring)، `docs/adr/013-quick-filters-export.md`، `docs/architecture.md` §1، §4.1، §4.2 (4أ)، §4.3، §8أ.6 | `6dadd58` |
| 4 | مراجعة `engine.py` و `normalize.py`: حُذف `META_KEYS` (بلا أي مرجع)، ودُمج `_normalize_chart` (تمرير بسيط) في `normalize`، وحُذف `worker_threshold` من `settings.py` و `get_meta.limits` (يناقض تعديل ADR-009 «لا `worker_threshold`» وعقد §2.2 `limits: {max_rows}`، ولا يقرؤه أي كود في المتصفح)، وحُدّثت تعليقات «المرحلة 3/4» البائتة | تم | `core/normalize.py`، `core/settings.py`، `api/__init__.py`، `tests/test_get_meta.py` | `040ed10` |

لا دالة whitelisted جديدة. `export_xlsx` ما زالت تبدأ بـ `guard_report` ثم `guard_export`. لا `ignore_permissions`، لا `set_user`، لا `db.sql` / `get_all` في أي مسار بيانات. `expressions.py` و `engine.py` دوال خالصة بلا قاعدة بيانات.

## 2. قرار ADR-013 باختصار
- الخياران المطروحان: (أ) قواعد تعابير مغلقة يقيّمها الخادم على حقائق تشغيله، (ب) المتصفح يرسل قائمة `__rid` الناجية. اخترتُ (أ): أبسط للمتصفح (يرسل تعريفات موجودة لديه)، ولا يتأثر حجم النموذج بعدد الصفوف (قائمة 50,000 معرّف تتجاوز حد 256 KB)، ويبقى مبدأ ADR-001 كما هو: التعبير يضيّق صفوفاً أعادها الخادم بصلاحيات المستخدم، وأي اختلاف يُمسك بـ `expected`.
- دلالات `null` **قيستها في node على Perspective 3.8.0 قبل الكتابة** (سكربت مؤقت حُذف): العمود المجرّد وقيمته `null` يُقارن كأكبر قيمة (`>`, `>=`, `!=` تصدق)، و `abs(null)` كأصغر قيمة (`<`, `<=`, `!=` تصدق)، و `and` قبل `or`. الجدول الكامل في ADR-013 ومثبّت حرفياً في `tests/test_expressions.py`.
- خارج القواعد (`not`، عمود مقابل عمود، نصوص، دوال أخرى) ⇒ `RVInvalidViewState` يسمّي الفلتر. الخادم لا يخمّن.
- ملاحظة من القياس: `abs()` على عمود `integer` في Perspective يعيد `false` دائماً؛ لا يمسّنا لأن `Int` يُحمَّل `float` في الطرفين.

## 3. عقد المتصفح (المطلوب من وكيل الواجهة لاحقاً)
1. في `export_model()` (`index.js`): أضف `quick_filters: this.config.quick_filters.map(q => ({id: q.id, expression: q.expression}))` (كلها أو النشطة؛ بلا `label` ولا `exclusive`).
2. احذف من `view_state.quick_filters` في النموذج أي معرّف لا تعريف له (ما يعطي `QUICK_FILTER_UNKNOWN`)، وإلا يرفض الخادم بـ `RVInvalidViewState` «Quick filters without a definition».
3. احذف الرفض المسبق في `export_xlsx()` («الفلاتر السريعة تُطبَّق على الشاشة فقط حالياً»).
4. `expected` كما هو اليوم: مع فلتر سريع نشط الشكل `levels`/`flat` المضيَّق، والإجمالي من `view` والعدّ من `count_rows` بـ `post.fact_filter`؛ الخادم يطابق ذلك (`total_source = engine`).
5. يُستحسن إضافة حالة بفلتر سريع إلى `tests/fixtures/screen/generate.mjs` حتى يطابق `test_engine.py` صفوف الشاشة تحته صفاً بصف.
6. حدّث `docs/progress/phase-5a2-wave1.md` (الدين رقم 1) عند الإغلاق.

## 4. الاختبارات
```
bench --site acc.dev.sanad.digital run-tests --app report_view
Ran 31 tests (unit)          OK
Ran 51 tests (integration)   OK
```
82 اختباراً (كانت 47 منها 1 يفشل). الجديدة:
- `test_expressions.py` (4): الدلالات تطابق جدول قياس Perspective (28 تعبيراً × 5 صفوف)، المفاتيح، المرفوض (19 نصاً + الطول + العمق + الأنواع)، المفتاح الغائب = `null`.
- `test_engine.py::test_quick_filter_narrows_the_facts`: على العينة `trial_balance_fy2026`: `abs("closing_debit") > 0.005` ⇒ الشكل `levels`، الإجمالي `engine`، العدّ والمجاميع تساوي حساباً مستقلاً، الأوراق بترتيب التقرير، فلتران = `and`، معرّف بلا تعريف لا يُطبَّق، بلا معرّف نشط ⇒ الشجرة «كما هي»، ومع فلتر عمود يضيّقان معاً.
- `test_export.py`: `test_quick_filter_export_equals_the_filtered_totals` (مستخدم مسموح؛ تشغيل حقيقي لميزان المراجعة، `expected` محسوب من الرد، الملف يحوي الأوراق المحتفَظ بها دون المحذوفة والإجمالي مجموعها، و`expected` الشجرة الكاملة ⇒ `RVExportMismatch`)، `test_quick_filter_definitions_are_validated` (11 حالة رفض + تعريف غير نشط بعمود مجهول يمر)، `test_quick_filter_denied_user` (`PermissionError`).
- `test_api_run.py::test_count_rows_rule`.
- ruff check + ruff format: نظيفان على `report_view/core`، `api`، `tests`.

التحذيران الباقيان في سجل الاختبار من خارج تطبيقنا: `limit_page_length` (يُرمى من `frappe/model/qb_query.py:153` عبر استدعاء داخل Frappe نفسه؛ `grep -rn limit_page_length report_view --include=*.py` فارغ بعد هذه الجولة)، و `get_number_format_info` من `erpnext/accounts/utils.py:1195`.

## 5. ما لم يكتمل / ملاحظات
- جانب المتصفح من ADR-013 (§3 أعلاه) خارج نطاق هذه الجولة؛ إلى حينه الواجهة ما زالت ترفض التصدير مع فلتر سريع، والخادم جاهز.
- `DEFAULT_MAX_ROWS = 50000` في `settings.py` بينما تعديل ADR-009 و §5.2 يقولان 100,000 افتراضياً مع سقف 200,000 عبر `Report View Global Settings` (غير مبني بعد). لم أغيّره: الاختبارات تثبّت 50,000 والقرار يحتاج صاحب المشروع (رفع الحد بلا DocType الإعدادات يغيّر السلوك بصمت).
- §5.1 في المعمارية يصف `quick_filters` بـ `{id, label, filter}` بينما الكود `{id, label, expression, exclusive?}`؛ هذا قسم المتصفح فلم ألمسه، ويُصحَّح مع تنفيذ جانب المتصفح.
