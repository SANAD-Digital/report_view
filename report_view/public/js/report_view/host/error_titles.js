// The titles of the server's refusals (exc_type of the answer), shown by the page's error
// state and by the Excel export. Functions, so __() runs once the messages are loaded.
export const ERROR_TITLES = {
	PermissionError: () => __("You do not have permission to open this report"),
	DoesNotExistError: () => __("Report not found"),
	RVUnsupportedReport: () => __("This report type is not supported in Report View"),
	RVInvalidInput: () => __("The request was not valid"),
	RVReportError: () => __("The report raised an error"),
	ValidationError: () => __("The report could not run"),
	RVNoExport: () => __("You are not allowed to export this report"),
	RVExportMismatch: () => __("The exported totals do not match the screen"),
};
