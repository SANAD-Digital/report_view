# ADR-005: صفحة Desk من نوع Page على `/desk/report-view/<name>`

- الحالة: مقبول
- التاريخ: 2026-09-30

## السياق
- البادئة في Frappe 16 هي `/desk/`، و `/app/*` إعادة توجيه خادمية (`frappe/router.js:104-112`، `frappe/hooks.py:68-72`). ملفا المرحلتين 3 و 4 يذكران `/app/report-view/<name>`؛ سيعمل كإعادة توجيه.
- ثلاث طرق لتعريف الصفحة (`docs/research/frontend-query-report.md` §8): `frappe.views.<X>Factory`، مستند `Page`، أو `frappe.standard_pages`.
- الاسم `frappe.views.ReportView` مأخوذ لـ Report Builder (`frappe/public/js/frappe/views/reports/report_view.js:9`)، فطريقة Factory تتصادم معه.

## الخيارات
1. Factory: مرفوض للتصادم.
2. `frappe.standard_pages["report-view"]`: يتطلب تحميل ملفنا في كل صفحة عبر `app_include_js`.
3. مستند `Page` باسم `report-view` في وحدة التطبيق.

## القرار
الخيار 3. `desk_page.getpage` يحمّل سكربت الصفحة عند أول فتح فقط، ويفحص `Page.is_permitted()` (`frappe/desk/desk_page.py:7-25`، `frappe/core/doctype/page/page.py:126`). سكربت الصفحة صغير ويستدعي `frappe.require("report_view.bundle.js")` لتحميل المكتبات.
أدوار الصفحة: `Desk User` فقط. `getpage` معرّف بـ `allow_guest=True`، والأدوار الفارغة تجعل `is_permitted` يسمح للجميع؛ تحديد `Desk User` يمنع الضيف ومستخدمي الموقع من تحميل السكربت. الصلاحية الحقيقية تبقى صلاحية التقرير في `run` و `get_meta`.

## العواقب
- الرابط `/desk/report-view/Trial%20Balance?company=...`.
- الصفحات الأخرى لا تحمّل Perspective ولا ملفات WASM ولا `regular-table` ولا ECharts (شرط المرحلة 4).
