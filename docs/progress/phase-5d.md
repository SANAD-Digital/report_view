# تقرير المرحلة 5د: الرسوم والتفصيل

- الفرع: `letterhead-builder` (يُدفع إلى `main` و `version-16`)
- التاريخ: 2026-10-28
- المهمة 1 (عرض الرسوم) و 4 (التسميات العربية) سُلّمتا في `phase-5a2-charts.md`؛ هذا التقرير يغطي الباقي: الرسم من النطاق وروابط Link والتفصيل المعرّف.

## ما أُنجز
| الجزء | الملف | الوصف |
|---|---|---|
| الرسم من النطاق | `views/range_chart.js` (في `report_view_charts.bundle.js`) | نافذة (غلاف الدرج/النافذة المشترك) فيها رسم ECharts بـ `chart_option` نفسها ولوحة صغيرة لنوعه (أنواع `features.chart_types` بلا بطاقة الرقم). الصفوف هي ما يجمعه شريط الحالة (`countable_rows`) فلا تُرسم مجموعة مع أبنائها، والسلاسل الأعمدة الرقمية (حتى 8، والفئات حتى 200 مع ملاحظة). قيمه من `range_data` بـ `view` خاص بالنافذة (`[[__rid, "in", …]]`) يبقى مفتوحاً معها ويُحذف عند إغلاقها؛ الألوان `--c1..--c7` |
| غلاف الدرج | `components/drawer.js` | غلاف تفاصيل السطر نفسه (`.rv-rd` و `.rv-rd-drawer`/`.rv-rd-dialog`): عنوان، جسم، أفعال، Esc، حبس Tab، إعادة التركيز لمن فتحه؛ مشترك مع حزمة الرسوم عبر `report_view.shared` |
| روابط Link | `views/grid_view.js` `open_link`، `host/range_host.js` | قيمة عمود Link (ثابت، ديناميكي من عمود النوع، أو من فلتر) تفتح مستندها حسب إعداد جديد `link_open`: «New tab» (الافتراضي، `window.open` بـ `noopener`)، «Same tab» (`frappe.set_route`)، «Drawer» (حقول المستند في درج من `frappe.db.get_doc` بصلاحيات المستخدم). Ctrl/⌘ تفتح تبويباً جديداً دائماً. رابط بنى له منسّق التقرير `onclick` خاصاً يُترك للتقرير |
| قواعد التفصيل | `core/drill.py`، `state/drill.js` | القاعدة `{label, source_column, report, filters: {<فلتر الهدف>: "row:<عمود>" \| "filter:<فلتر>" \| قيمة \| قائمة منها}}`؛ تحقق صارم عند الحفظ (التقرير الهدف موجود وغير معطّل ومفعّل في Report View، المراجع أسماء حقول، العناوين فريدة، 20 قاعدة على الأكثر)، والمحمّل يُبقي الصالح فقط. الصلاحية تُفحص عند التشغيل للمستخدم نفسه |
| التفصيل في الدرج | `host/drill_host.js` | «تفصيل إلى <العنوان>» من القائمة السياقية ومن تذييل درج تفاصيل السطر يفتح درجاً: `api.get_meta` للهدف، سكربته، **`api.run` نفسه** بالفلاتر المحوّلة، المحوّل، جلسة Perspective خاصة، و `GridView` نفسه مضغوطاً (فرز بالعنوان، طي الشجرة). الرفض يُعرض كما جاء ولا يُرسم شيء. الإغلاق (أو تشغيل جديد للتقرير) يحذف عروضه وجداوله (`session.close`). «فتح في Report View» يفتح الهدف بفلاتره |
| التفصيل المشحون | `defaults/trial_balance.json` | ميزان المراجعة ← General Ledger: الشركة والفترة ودفتر التمويل ومركز التكلفة والمشروع والعملة من فلاتر الصفحة، `account: ["row:account"]`، و `categorize_by` «Categorize by Voucher (Consolidated)» |
| الإعدادات | DocType `Report View Settings` | ميزتا `range_selection` و `drill` (افتراضياً مفعّلتان)، وقسم «Drill» فيه `link_open` و `drilldowns` (JSON). قاعدة السجل تُضاف إلى المشحونة، وبالعنوان نفسه تحل محلها. أُضيفت بـ `reload-doc` (لا migrate) |
| تقوية الصلاحيات (قرار صاحب المشروع) | `core/runner.py` `check_list_filters`، ADR-021 (تعديل) | كل قيمة لفلتر `MultiSelectList` مشحون خياراته DocType تُفحص بـ `frappe.has_permission(options, "read", doc=value)` قبل التشغيل، وتُرفض بـ `PermissionError` مترجم |

## شروط القبول
| الشرط | النتيجة | الدليل |
|---|---|---|
| أرقام الرسوم مطابقة للجدول لنفس الفلاتر | نجح (الرسم من النطاق) | `tests/visual/range.spec.js` «chart from range…»: مجموع سلسلة المدين على النطاق «النقدية … مجموع المخزون» = مدين «الأصول المتداولة» في التقرير، وعدد الفئات = عدد الصفوف التي يجمعها الشريط. عرض الرسوم نفسه في `phase-5a2-charts.md` |
| التفصيل يحترم الصلاحيات (`rv_restricted` لا يفتح حساب شركة أخرى) | نجح | بايثون `report_view/tests/test_drill.py::test_the_restricted_user_cannot_drill_into_another_companys_account`: شركة أخرى ← مرفوض؛ شركته مع حساب شركة أخرى ← `PermissionError` (التقوية)؛ حسابه ← يعمل؛ المحاسب ← يعمل. الموقع: `tests/site/drill.cjs` (انظر «الاختبارات» أدناه). المتصفح: `drill.spec.js` «the server's refusal is shown» |
| لقطات بالعربية والإنجليزية وفاتح وداكن | نجح | `drill-tb-gl-{ar,en}-{light,dark}.png` و `chart-from-range-{bar,line}-{ar,en}-{light,dark}.png` وغيرها (المسار في «الاختبارات») |
| مراجعة `reviewer`: قبول | لم تُجرَ | مطلوبة قبل الإغلاق |

## الاختبارات والأداء
| الاختبار | الأمر | النتيجة |
|---|---|---|
| وحدات JS | `node --test tests/js/*.test.mjs` | 256/256 (جديد: `range.test.mjs` نموذج التحديد، الأسهم في RTL، القاعدة، الحساب على `to_columns` من Perspective حقيقي بمجموعة مطوية، ترميز TSV/HTML؛ `drill.test.mjs` القواعد والتحويل والقاعدة المشحونة و `link_open`) |
| بايثون | `bench --site acc.dev.sanad.digital run-tests --app report_view` | 306 اختباراً، OK (جديد: `test_drill.py` 7: القاعدة المشحونة، رفض القواعد غير الصالحة والتقرير غير الموجود، قاعدة السجل تصل إلى `get_meta`، إيقاف الميزتين، تشغيل GL بالفلاتر المحوّلة ومدينه ودائنه = ميزان المراجعة، `rv_restricted` مرفوض) |
| المرئية (Chromium) | `RV_WORKERS=1 playwright test -c tests/visual` | 273/273 (منها `range.spec.js` 16 و `drill.spec.js` 8) |
| المرئية (Firefox) | `RV_BROWSERS=firefox RV_WORKERS=1 …` | 273/273 |
| المرئية (WebKit) | `RV_BROWSERS=webkit RV_WORKERS=1 … range.spec.js drill.spec.js` | 24/24 (الحزمة كاملة في CI) |
| فحص الموقع | `node tests/site/drill.cjs` (rv_accountant و rv_restricted على `acc.dev`) | 13/13: القاعدة في `get_meta`؛ القائمة تعرض «تفصيل إلى General Ledger»؛ الدرج بشبكة 28 صفاً؛ الفلاتر = الحساب والفترة والشركة؛ قيود الحساب وحده ومدينها = مدين الميزان (692,311)؛ Esc يحذف العروض (3 ← 3)؛ لا أخطاء؛ `rv_restricted` بشركة أخرى ← درج الرفض بلا شبكة؛ API: شركة أخرى 403، شركته مع حساب شركة أخرى 403 `PermissionError`، حسابه 200 |
| الأداء 100k | `node tests/perf/measure.cjs 100000 ar` | قبل (تشغيل واحد): التحميل 8305ms، التمرير ×40 2443ms، الفرز 501ms. بعد (وسيط 3): 6653 / 2249 / 281ms؛ لا تراجع (لا شيء من التحديد يعمل بلا نطاق) |

اللقطات (عربي وإنجليزي، فاتح وداكن): `/tmp/claude-1001/-home-snd-frappe-bench-apps-whatsapp-next/cee31a8f-e114-4e4c-848f-7cf3dbc132e2/scratchpad/range/` (خارج المستودع): `drill-tb-gl-*`، `drill-from-row-details-en`، `drill-refused-*`، `chart-from-range-{bar,line}-*`، `tb-range-open-*`، `tb-range-folded-*`، `ar-group-range-en`، `tb-keyboard-range-ar`، `tb-context-menu-{ar,en}`، `gl-link-drawer-en`، `site-drill-tb-gl`، `site-drill-refused`.

## القرارات المتخذة
- التفصيل يحوّل القيم في المتصفح (`state/drill.js`) ويشغّل الهدف بـ `api.run` نفسه: القاعدة لا تمنح شيئاً، والخادم يفحص كل ما يفحصه للصفحة.
- «Drawer» في `link_open` يعرض حقول المستند كما يعيدها Frappe للمستخدم (`frappe.client.get`)، لا نموذج Desk في إطار.
- ADR-021 عُدّل: قيم `MultiSelectList` المشحونة تُفحص الآن (كانت تمر بلا فحص كما في Frappe).

## الانحرافات عن الخطة أو التصميم
- مفتاح الإعدادات `drilldowns` (الموجود سلفاً في `empty_settings`) بدل اسم جديد.

## المخاطر والأسئلة المفتوحة
- الفحص الجديد يرفض تشغيل تقرير مشحون إذا احتوى فلتر قائمة قيمة لا يقرؤها المستخدم (كما يُرفض Link)؛ قيمة ليست مستنداً تُترك للتقرير.
- الفحص الجديد يعمل على `acc.dev` (فحص الموقع 403 `PermissionError`).

## المطلوب من صاحب المشروع
- مراجعة `reviewer`.
