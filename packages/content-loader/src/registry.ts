import type {
  Content,
  CollectionName,
  Definition,
} from "../../content-schemas/src/definitions";
import { assertContent } from "../../content-schemas/src/validate";
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export class ContentRegistry {
  readonly content: Content;
  private readonly indexes = new Map<string, Map<string, unknown>>();
  constructor(
    content: Content,
    readonly version: string,
  ) {
    assertContent(content);
    this.content = freeze(structuredClone(content));
    for (const [k, v] of Object.entries(this.content))
      this.indexes.set(
        k,
        new Map(v.items.map((x: { id: string }) => [x.id, x])),
      );
  }
  get<K extends CollectionName>(collection: K, id: string): Definition<K> {
    const item = this.indexes.get(collection)?.get(id);
    if (!item)
      throw new Error(`Missing ${collection}/${id} in ${this.version}`);
    return item as Definition<K>;
  }
  all<K extends CollectionName>(collection: K): readonly Definition<K>[] {
    return this.content[collection].items as Definition<K>[];
  }
  has(collection: CollectionName, id: string) {
    return this.indexes.get(collection)?.has(id) ?? false;
  }
}
