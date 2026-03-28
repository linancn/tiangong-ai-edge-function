const SYNONYM_KEYS = [
  'common:synonyms',
  'common_synonyms',
  'synonyms',
  'synonym',
  'aliases',
  'alias',
];

function normalizeTerm(term: string): string {
  return term.replace(/\s+/g, ' ').trim();
}

function splitSynonymString(value: string): string[] {
  return value
    .split(/[;\n\r|；]+/g)
    .map((part) => normalizeTerm(part))
    .filter((part) => part.length > 0);
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return splitSynonymString(value);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => collectStringValues(item));
}

function dedupeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const term of terms) {
    const normalized = normalizeTerm(term);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

export function extractSynonymTerms(source: unknown): string[] {
  if (!source || typeof source !== 'object') {
    return [];
  }

  const record = source as Record<string, unknown>;
  const collected = SYNONYM_KEYS.flatMap((key) => collectStringValues(record[key]));
  return dedupeTerms(collected);
}

export function mergeSynonymTerms(...lists: Array<string[] | undefined>): string[] {
  return dedupeTerms(lists.flatMap((list) => list || []));
}

export function prependSynonymsToText(text: unknown, synonyms: string[]): string {
  const normalizedText = typeof text === 'string' ? text.trim() : String(text ?? '').trim();
  if (!normalizedText) {
    return normalizedText;
  }

  const uniqueSynonyms = dedupeTerms(synonyms).filter((term) => {
    return !normalizedText.toLowerCase().includes(term.toLowerCase());
  });

  if (uniqueSynonyms.length === 0) {
    return normalizedText;
  }

  return `Synonyms: ${uniqueSynonyms.slice(0, 12).join('; ')}\n\n${normalizedText}`;
}
