import fs from "node:fs";
import path from "node:path";
import type { SiteFiles } from "./types";

export const TEMPLATE_DIR = path.join(process.cwd(), "demo-site");

/** The demo website every run starts from (version 0). */
export function loadTemplate(dir = TEMPLATE_DIR): SiteFiles {
  const files: SiteFiles = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (/\.(html|css|svg)$/.test(name)) files[name] = fs.readFileSync(path.join(dir, name), "utf8");
  }
  return files;
}
