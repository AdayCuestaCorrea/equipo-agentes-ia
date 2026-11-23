import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { loadTemplate } from "./template";

it("the embedded template matches demo-site/ (run `npm run gen:template` after editing it)", () => {
  const dir = path.join(process.cwd(), "demo-site");
  const onDisk = Object.fromEntries(
    fs.readdirSync(dir).filter((n) => /\.(html|css|svg)$/.test(n)).map((n) => [n, fs.readFileSync(path.join(dir, n), "utf8")]),
  );
  expect(loadTemplate()).toEqual(onDisk);
});
