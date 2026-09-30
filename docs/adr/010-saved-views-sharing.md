# ADR-010: نموذج مشاركة العروض المحفوظة

- الحالة: مقبول
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
