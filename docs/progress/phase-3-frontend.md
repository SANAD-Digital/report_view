# المرحلة 3 — جزء الواجهة

كتبه المنسّق من التقرير النهائي لوكيل `frontend-dev` ومن إصلاحات المنسّق بعده.

## ما بُني
| المسار | المحتوى |
|---|---|
| `report_view/report_view/page/report_view/` | مستند Page `report-view` (وحدة Report View، دور `Desk User`)؛ `report_view.js` يحمّل Arquero ثم `report_view.bundle.js` و `.css` بـ `frappe.require` |
| `public/js/report_view/adapter/` | `columns.js`، `classify.js`، `tree.js`، `normalize.js`، `enrich.js`: المحوّل حسب §3 المعدّل |
| `public/js/report_view/engine/` | `aggregate.js`، `filter.js`، `sort.js`، `group.js` (Arquero)، `tree_view.js`، `engine.js`؛ إجمالي الشجرة = مجموع الجذور بلا فلتر عرض، والمجموعات من الأوراق، ولا إجمالي لعملات مختلطة؛ `expected()` يبني كتلة `expected` لنموذج التصدير |
| `public/js/report_view/state/` | `view_state.js`، `url.js` (المعامل `rv` بـ base64url، يُحذف فوق 2,000 حرف، تحديث بعد 300 ms) |
| `api.js`، `format.js` | نداءات الخادم وقراءة `exc_type`؛ Excel بـ `fetch` لعرض خطأ JSON؛ `frappe.format` بـ `{inline: true}` والـ formatter الأصلي للصفوف الأصلية فقط |
| `filters/facade.js`، `report_filters.js` | كائن الواجهة ADR-006 (يُعاد عند الإخفاء، ويرمي لأي عضو غير مدعوم في وضع التطوير)؛ الفلاتر بـ `make_control` مع default و reqd و depends_on و on_change و get_query وقيم الرابط، و `js_filters` مع كل تشغيل |
| `views/grid_view.js` | Tabulator بـ dataTree، أشرطة الرؤوس، عمود أول مثبّت، `bottomCalc` يعيد قيم المحرك، `textDirection` للـ RTL؛ التجميع بعنصر MultiSelectList |
| `components/states.js` | تحميل، خطأ، لا نتائج، too_large، prepared_pending/missing، فلاتر ناقصة، تقرير غير مفعّل |
| `index.js`، `register.js`، `configs/trial_balance.js`، `report_view.bundle.js` | الصفحة، التسجيل، إعداد ميزان المراجعة |
| `public/css/` | `rv_tokens.css` (من `rv.css`)، `rv_components.css` (خصائص منطقية فقط)، `report_view.bundle.scss` |
| `tests/js/` | `normalize.test.mjs`، `engine.test.mjs`، `state.test.mjs` |
| `tests/e2e/trial_balance.spec.js` | كتبه المنسّق (انظر أدناه) |

## النتائج
```
npm run test:js          → pass 27, fail 0
bench build --app report_view → DONE (report_view.bundle.js 972 KB، bundle.css 45 KB)
npx playwright test trial_balance → 6 skipped
```
- الحالات المشتركة الأحد عشر: ناتج المحوّل JS يطابق `expected` تماماً دون تعديل الحالات.
- الإجماليات في `engine.test.mjs`: ميزان المراجعة (الشجرة) = صف `'Total'`؛ AR = صف مجموع Frappe؛ AR حسب الطرف و GL = آخر مجموع داخلي. `balance` و `age` مستثنيان (ADR-008).
- Playwright: الاختبارات الستة تُتخطى برسائل واضحة لأن `RV_E2E_USER` غير معرّف ومستخدمي `rv_*` غير موجودين.

## إصلاحات المنسّق
- **البناء كان يفشل** (ذكر الوكيل أنه نجح دون قراءة المخرجات): `@import` في `report_view.bundle.css` لا يُحل في مجلد البناء المؤقت ⇒ حُوّل إلى `.scss` بمسارات SCSS. ومصدر Arquero 8 يستورد `@uwdata/flechette` بأرقام BigInt و `for await`، وهدف البناء في Frappe es2017 ثابت ⇒ Arquero يُحمَّل من `node_modules/arquero/dist/arquero.min.js` كملف مستقل، ويُحقن في المحرك بـ `use_arquero` (مع الرجوع إلى `globalThis.aq`). الاختبارات في node تمرّر الحزمة نفسها.
- مستند الصفحة زُامن بـ `bench --site acc.dev.sanad.digital reload-doc report_view page report_view`؛ الضيف يُحوَّل إلى تسجيل الدخول.
- ترجمات نصوص الواجهة (34) أُضيفت إلى `report_view/locale/ar.po`.

## انحرافات
- `test:js` = `node --test 'tests/js/*.test.mjs'` لأن Node 24 لا يقبل مجلداً.
- `public/js/report_view/package.json` بـ `"type": "module"` ليستورد node الوحدات؛ جذر المستودع `commonjs`.
- المحوّل JS يقبل الترجمات العربية لـ «Opening» و «Closing (Opening + Total)» و «Total»؛ بايثون يقبل الإنجليزية فقط. الحالات المشتركة بالإنجليزية فلا يظهر الفرق.
- `configs/trial_balance.js` يضيف `bands` و `columns[*].band/side` للرؤوس المجمّعة؛ غير مذكورة في §5.1 وتُضاف إليه في المرحلة 4.

## أسئلة مفتوحة
- التجميع يبني المجموعات من الأوراق، فالعمودان الختاميان فيه مجموع أرصدة صافية (24,653,599) لا يقابل صف الأصل (7,553,469). مطابق لـ N4.7 لكنه قد يربك المستخدم.
- §13.2: من الكود `_right` في `formatters.js:11-17` يعيد القيمة المجردة عند `inline`. لم يُتحقق في المتصفح.

## لم يُنجز
- لا تحقق في المتصفح إطلاقاً: RTL/LTR، فاتح/داكن، 390px، console. السبب غياب حساب دخول للاختبار.
- لا لقطات شاشة.
