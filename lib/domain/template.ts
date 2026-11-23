import { TEMPLATE } from "./template.generated";
import type { SiteFiles } from "./types";

/** The demo website every run starts from (version 0), embedded from demo-site/ at build time. */
export function loadTemplate(): SiteFiles {
  return { ...TEMPLATE };
}
