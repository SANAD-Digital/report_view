// The font registry in the bundle: the one report_view/fonts.json the server also reads
// (core/fonts.py), imported by esbuild and handed to fonts.js.
import REGISTRY from "../../../fonts.json";
import { set_font_registry } from "./fonts.js";

set_font_registry(REGISTRY);
