// Loaded by the report-view page the first time the Charts view opens
// (frappe.require("report_view_charts.bundle.js"), docs/architecture.md §8): ECharts and the
// Charts view. The CSS of the view is part of report_view.bundle.css.
import { ChartsView } from "./report_view/views/charts_view.js";

frappe.provide("report_view");
window.report_view.ChartsView = ChartsView;
