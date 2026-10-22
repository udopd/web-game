import { readFile } from "node:fs/promises";
import {
  CONTENT_PATHS,
  type Content,
} from "../packages/content-schemas/src/definitions";
import { assertContent } from "../packages/content-schemas/src/validate";
export async function loadContent(root = "content/base-game") {
  const data = Object.fromEntries(
    await Promise.all(
      Object.entries(CONTENT_PATHS).map(async ([key, path]) => [
        key,
        JSON.parse(await readFile(`${root}/${path}`, "utf8")),
      ]),
    ),
  );
  assertContent(data);
  return data as Content;
}
