# المرحلة 0: البيئة والأساس

**الوكلاء:** المنسّق فقط.
**لا كود إنتاج في هذه المرحلة.**

## المهام
1. حدد مسار الـ bench، والموقع المستخدم للتطوير، وإصدارات: frappe، erpnext، Python، Node، MariaDB، وأداة PDF المستخدمة (wkhtmltopdf أو Chrome).
2. تأكد أن `bench build` و `bench --site $SITE run-tests --app frappe --module frappe.tests.test_utils` يعملان.
3. أنشئ التطبيق فارغاً: `bench new-app report_view` وثبّته على الموقع. أنشئ مستودع git وفرع `phase-0-setup`.
4. تأكد أن الموقع فيه بيانات محاسبية حقيقية أو تجريبية كافية (شركتان على الأقل، وقيود في أكثر من شهر). إن لم توجد، اذكر ذلك واقترح طريقة توليدها، ولا تولّدها قبل الموافقة.
5. أنشئ مستخدمي الاختبار، وسجّل أسماءهم وكلمات مرورهم في `docs/progress/phase-0.md` (موقع تطوير فقط):
   - `rv_admin`: System Manager
   - `rv_accountant`: Accounts User و Accounts Manager
   - `rv_restricted`: Accounts User مع User Permission على شركة واحدة
   - `rv_noexport`: Accounts User مع إلغاء صلاحية Export على GL Entry و Account
   - `rv_none`: مستخدم بلا أي دور محاسبي
6. ثبّت Playwright في مجلد التطبيق وتأكد أنه يفتح الموقع ويسجّل الدخول.
7. تأكد أن `reference/prototype/` و `reference/design/` موجودان وغير فارغين.

## شروط القبول
- [ ] كل الإصدارات مسجّلة في التقرير
- [ ] التطبيق مثبت و `bench build --app report_view` ينجح
- [ ] المستخدمون الخمسة موجودون وكل واحد يسجّل الدخول
- [ ] اختبار Playwright بسيط يفتح `/app` بكل مستخدم وينجح
- [ ] المرفقات موجودة

## المخرج
`docs/progress/phase-0.md` ثم توقف.
