# ADR-010: نموذج مشاركة العروض المحفوظة

- الحالة: مقبول، **بُني** (2026-10-28، قرار صاحب المشروع 2026-10-27): DocType `Report View Saved View` وجدوله `Report View Saved View Role`، `core/saved_views.py` (الرؤية، الـ hooks، التحقق، الافتراضيات)، `report_view.api.views` (§2.7)، قائمة «العروض» في رأس التقرير (`components/views_menu.js`، `host/saved_views_host.js`)، `Report View Settings.default_saved_view` والدور `Report View Manager`. التفاصيل وما يختلف عن الخطة في `docs/architecture.md` §6 «كما بُني». الإعدادات المحفوظة للطباعة (ADR-020) شيء آخر
- التاريخ: 2026-09-30

## السياق
- `CLAUDE.md`: العرض الخاص لا يراه ولا يعدّله إلا مالكه.
- المرحلة 5هـ: مشاركة خاص / أدوار / عام، وعرض افتراضي.
- مشاركة Frappe العادية (`DocShare`) تسمح لأي مستخدم بصلاحية share بكشف مستند؛ لا نريد مسارين للمشاركة.

## القرار
- حقل `visibility`: `Private` | `Roles` | `Public`، وجدول فرعي `roles` للخيار الثاني.
- DocPerm للدور `Desk User` لا `All` (`All` يشمل مستخدمي الموقع، `permissions.py:558`): `read`, `create`، و `write`, `delete` بـ `if_owner`. لا `share`.
- شرط رؤية واحد (`is_visible`) يُطبَّق في ثلاث طبقات: الـ pqc (يشمل التقارير المسموحة عبر `DeskViews.get_allowed_report_names`، `frappe/desk/desk_views.py:111`)، و hook `has_permission` لـ `read`، والـ API صراحة. السبب: واجهات REST القياسية لا تمر بـ `guard_report`، و Administrator يتجاوز الـ hook بالاسم (`permissions.py:107`).
- الكتابة والحذف: المالك فقط. System Manager لا يتجاوز الـ hook، فلا استثناء له.
- «المالك» يعني المالك **المخزّن** لا قيمة `owner` في الطلب: REST يطبّق التعديلات قبل فحص الصلاحية، فيُقرأ المالك من `get_doc_before_save()` أو من قاعدة البيانات، و `validate` يمنع تغيير `owner` (`docs/architecture.md` §6، `phase-2-review.md` ح4).
- كل التحقق (الحالة، الأدوار، الرؤية) في `validate` المتحكم لا في الـ API وحده.
- **الافتراضيات بلا DocType:** افتراضي المستخدم في `frappe.defaults` للمستخدم الحالي (`report_view_default::<report>`)، والافتراضي العام في `Report View Settings.default_saved_view` (حقل Data لا Link). هذا يمنع فرض افتراضي على مستخدم آخر، ويمنع `LinkExistsError` عند حذف عرض (`frappe/model/delete_doc.py:164-172`)، ويلغي الحاجة لمهمة تنظيف مجدولة.
- التفاصيل وجدول القيم لكل ptype في `docs/architecture.md` §6.

## العواقب
- ملاحظة لصاحب المشروع خارج نطاقنا: `Contact` و `Address` في Frappe بنفس نمط `if_owner` وقابلان لنفس الاستيلاء عبر REST (`phase-2-review.md` ح4). لا نعدّلهما (`CLAUDE.md`).
- Administrator يستطيع فتح عرض خاص بالاسم عبر REST: قيد معروف (حساب صيانة). القوائم تُصفّى له بالـ pqc، وواجهاتنا تطبّق `is_visible` عليه.
- DocShare يتغلب على كل الطبقات (`permissions.py:208-209`)، ولا ينشئه إلا Administrator لغياب `share`. يُختبر في المرحلة 4.
- دور جديد `Report View Manager` يُشحن مع التطبيق لتعديل الإعدادات والافتراضي العام.

## التنفيذ (2026-10-28)
- **الاختبار:** `report_view/tests/test_saved_views.py` (مصفوفة الخصوصية: خاص، عام، أدوار؛ System Manager بلا استثناء؛ Administrator؛ استيلاء REST بـ `PUT {"owner": ...}` و `DELETE` و `POST` باسم مالك آخر؛ تحقق الحالة؛ الافتراضيات وأولويتها وتقادمها)، `tests/js/saved_views.test.mjs`، `tests/visual/saved_views.spec.js`، والفحص الحي `tests/site/saved_views.cjs` (rv_accountant و rv_restricted).
- **أشد من الخطة:** الكتابة والحذف للمالك المخزّن حتى لـ Administrator (`check_owner` في `validate` و `on_trash`)؛ يبقى له قراءة الخاص بالاسم عبر REST (قيد Frappe).
- **الواجهة:** زر «العروض» في رأس الصفحة يسمّي العرض المطبَّق ويُظهر نقطة حين تختلف الصفحة عنه؛ القائمة: «القياسي»، «عروضي»، «مشتركة معي»، نجمة «افتراضيّ أنا»، حفظ، حفظ كجديد (من يراه: أنا فقط / مستخدمو بعض أدواري / كل من يفتح التقرير، ومع فلاتر التقرير أو بدونها)، تعديل، حذف. على الهاتف لوح من الأسفل كقوائم الطباعة.
- **الرابط:** `view=<name>`، و `rv` معه بعد التغيير (§7.4). العرض يمر عند التطبيق بـ `sanitize` ثم `restrict_state` (مزايا Report View Settings)، وتُعاد ربط أعمدته بـ `columns_ref` (§7.3).
