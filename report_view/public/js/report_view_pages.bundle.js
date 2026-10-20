// Loaded by the report-view page the first time the Pages view is used (frappe.require
// ("report_view_pages.bundle.js"), ADR-014): the Pages view and its layout. Its CSS is part
// of report_view.bundle.css.
import { PagesView } from "./report_view/views/pages_view.js";

frappe.provide("report_view");
window.report_view.PagesView = PagesView;
