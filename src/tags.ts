/**
 * Test tag helpers: normalize @sanity / sanity, parse @tags from titles, merge with explicit tags.
 */

export function normalizeTestTag(t: string): string {
  return t.trim().replace(/^@+/, '').toLowerCase();
}

export function normalizeTestTagList(tags: string[] | undefined): string[] | undefined {
  if (!tags?.length) return undefined;
  const u = [...new Set(tags.map(normalizeTestTag).filter(Boolean))];
  return u.length ? u : undefined;
}

/**
 * Collect @word tokens from a test title (start of string or after whitespace).
 * Avoids matching email-like `user@domain` (requires @ after ^ or whitespace).
 */
export function tagsFromTestTitle(name: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\s)@([a-zA-Z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(name)) !== null) {
    out.push(normalizeTestTag(m[1]));
  }
  return out;
}

/** Title @tags plus explicit `{ tags: [...] }` (all normalized, deduped). */
export function mergeTestTags(name: string, explicit?: string[]): string[] | undefined {
  const merged = [
    ...new Set([...tagsFromTestTitle(name), ...(explicit?.map(normalizeTestTag) ?? [])]),
  ];
  return merged.length ? merged : undefined;
}
