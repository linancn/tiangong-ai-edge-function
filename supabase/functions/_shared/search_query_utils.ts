export interface MultilingualSearchQuery {
  semantic_query: string;
  fulltext_query_eng: string[];
  fulltext_query_chi_sim: string[];
  fulltext_query_chi_tra: string[];
}

export interface EnglishSearchQuery {
  semantic_query: string;
  fulltext_query_eng: string[];
}

export const multilingualQuerySchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    semantic_query: {
      title: 'SemanticQuery',
      description:
        'Canonical query term for semantic retrieval in the original user language when possible.',
      type: 'string',
    },
    fulltext_query_eng: {
      title: 'FulltextQueryENG',
      description: 'Dictionary-style aliases in English only. No intent or topic phrases.',
      type: 'array',
      items: {
        type: 'string',
      },
    },
    fulltext_query_chi_sim: {
      title: 'FulltextQueryChiSim',
      description:
        'Dictionary-style aliases in Simplified Chinese only. No intent or topic phrases.',
      type: 'array',
      items: {
        type: 'string',
      },
    },
    fulltext_query_chi_tra: {
      title: 'FulltextQueryChiTra',
      description:
        'Dictionary-style aliases in Traditional Chinese only. No intent or topic phrases.',
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: [
    'semantic_query',
    'fulltext_query_eng',
    'fulltext_query_chi_sim',
    'fulltext_query_chi_tra',
  ],
  additionalProperties: false,
};

export const englishQuerySchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    semantic_query: {
      title: 'SemanticQuery',
      description: 'Canonical query term for semantic retrieval in English.',
      type: 'string',
    },
    fulltext_query_eng: {
      title: 'FulltextQueryENG',
      description: 'Dictionary-style aliases in English only. No intent or topic phrases.',
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['semantic_query', 'fulltext_query_eng'],
  additionalProperties: false,
};

export const CONTROLLED_SYNONYM_RULES = `
Output rules:
1) Return dictionary-style synonyms or aliases only.
2) Do NOT output topic, intent, or explanatory phrases.
3) Prefer canonical names, standardized abbreviations, identifiers, transliterations, and common aliases.
4) Avoid explanatory sentences and punctuation-heavy fragments.
5) Keep outputs deterministic: canonical term first, then standardized abbreviations or identifiers, then common aliases.
6) Avoid near-duplicate variants that only add redundant words.
`;

const EN_FORBIDDEN_SUBSTRINGS = [
  'query',
  'search',
  'description',
  'topic',
  'question',
  'meaning',
  'definition',
];

const ZH_FORBIDDEN_SUBSTRINGS = ['查询', '检索', '描述', '主题', '问题', '含义', '定义'];

const CAS_PATTERN = /^\d{2,7}-\d{2}-\d$/;
const CJK_PATTERN = /[\u3400-\u9fff]/;
const LATIN_CHAR_PATTERN = /[a-z]/i;

function normalizeTerm(term: string): string {
  const normalized = term.replace(/\s+/g, ' ').trim();
  const casMatch = normalized.match(/^cas\s*(\d{2,7}-\d{2}-\d)$/i);
  if (casMatch?.[1]) {
    return casMatch[1];
  }
  return normalized;
}

function normalizeCompareKey(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizeTerm(item))
    .filter((item) => item.length > 0);
}

function hasForbiddenSubstring(term: string, candidates: string[]): boolean {
  return candidates.some((candidate) => term.includes(candidate));
}

function dedupeNearDuplicates(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const term of terms) {
    const key = normalizeCompareKey(term);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(term);
  }

  return out;
}

function sortTermsDeterministically(terms: string[], locale: string): string[] {
  return [...terms].sort((a, b) => a.localeCompare(b, locale));
}

function isDictionaryAliasEn(term: string): boolean {
  const normalized = normalizeTerm(term);
  const lowered = normalized.toLowerCase();

  if (!normalized || normalized.length > 160) {
    return false;
  }

  if (CAS_PATTERN.test(normalized)) {
    return true;
  }

  if (!LATIN_CHAR_PATTERN.test(normalized)) {
    return false;
  }

  if (hasForbiddenSubstring(lowered, EN_FORBIDDEN_SUBSTRINGS)) {
    return false;
  }

  if (normalized.split(' ').length > 12) {
    return false;
  }

  if (/[\n\r]/.test(normalized)) {
    return false;
  }

  return true;
}

function isDictionaryAliasCjk(term: string): boolean {
  const normalized = normalizeTerm(term);

  if (!normalized || normalized.length > 80) {
    return false;
  }

  if (CAS_PATTERN.test(normalized)) {
    return true;
  }

  if (!CJK_PATTERN.test(normalized)) {
    return false;
  }

  if (hasForbiddenSubstring(normalized, ZH_FORBIDDEN_SUBSTRINGS)) {
    return false;
  }

  if (/[\n\r]/.test(normalized)) {
    return false;
  }

  return true;
}

function seedEnglishTerms(semanticQuery: string, fulltextQueryEn: string[]): string[] {
  const seed = LATIN_CHAR_PATTERN.test(semanticQuery) ? semanticQuery : fulltextQueryEn[0] || '';
  const rest = fulltextQueryEn.filter((term) => term.toLowerCase() !== seed.toLowerCase());
  const sortedRest = sortTermsDeterministically(dedupeNearDuplicates(rest), 'en');
  return seed ? [seed, ...sortedRest] : sortedRest;
}

function seedChineseTerms(userQuery: string, fulltextQueryZh: string[]): string[] {
  const seed = CJK_PATTERN.test(userQuery) ? userQuery : fulltextQueryZh[0] || '';
  const rest = fulltextQueryZh.filter((term) => term !== seed);
  const sortedRest = sortTermsDeterministically(dedupeNearDuplicates(rest), 'zh-Hans-CN');
  return seed ? [seed, ...sortedRest] : sortedRest;
}

export function sanitizeMultilingualSearchQueryOutput(
  raw: MultilingualSearchQuery,
  userQuery: string,
): MultilingualSearchQuery {
  const normalizedUserQuery = normalizeTerm(userQuery);
  const semanticQuery = normalizeTerm(raw.semantic_query || normalizedUserQuery);

  let fulltextQueryEng = dedupeNearDuplicates(
    normalizeStringArray(raw.fulltext_query_eng).filter(isDictionaryAliasEn),
  );
  let fulltextQueryChiSim = dedupeNearDuplicates(
    normalizeStringArray(raw.fulltext_query_chi_sim).filter(isDictionaryAliasCjk),
  );
  let fulltextQueryChiTra = dedupeNearDuplicates(
    normalizeStringArray(raw.fulltext_query_chi_tra).filter(isDictionaryAliasCjk),
  );

  if (fulltextQueryEng.length === 0 && semanticQuery) {
    fulltextQueryEng = [semanticQuery];
  }

  if (fulltextQueryChiSim.length === 0 && CJK_PATTERN.test(normalizedUserQuery)) {
    fulltextQueryChiSim = [normalizedUserQuery];
  }

  if (fulltextQueryChiTra.length === 0 && CJK_PATTERN.test(normalizedUserQuery)) {
    fulltextQueryChiTra = [normalizedUserQuery];
  }

  return {
    semantic_query: semanticQuery || normalizedUserQuery,
    fulltext_query_eng: seedEnglishTerms(semanticQuery, fulltextQueryEng).slice(0, 6),
    fulltext_query_chi_sim: seedChineseTerms(normalizedUserQuery, fulltextQueryChiSim).slice(0, 6),
    fulltext_query_chi_tra: seedChineseTerms(normalizedUserQuery, fulltextQueryChiTra).slice(0, 6),
  };
}

export function sanitizeEnglishSearchQueryOutput(
  raw: EnglishSearchQuery,
  userQuery: string,
): EnglishSearchQuery {
  const normalizedUserQuery = normalizeTerm(userQuery);
  const semanticQuery = normalizeTerm(raw.semantic_query || normalizedUserQuery);

  let fulltextQueryEng = dedupeNearDuplicates(
    normalizeStringArray(raw.fulltext_query_eng).filter(isDictionaryAliasEn),
  );

  if (fulltextQueryEng.length === 0 && semanticQuery) {
    fulltextQueryEng = [semanticQuery];
  }

  return {
    semantic_query: semanticQuery || normalizedUserQuery,
    fulltext_query_eng: seedEnglishTerms(semanticQuery, fulltextQueryEng).slice(0, 6),
  };
}
