export interface QueryPack {
  semantic_query: string;
  lexical_query: string;
  semantic_query_en?: string | null;
  lexical_query_en?: string | null;
  lexical_aliases?: string[];
  lexical_aliases_en?: string[];
}

export interface EnglishQueryPack {
  semantic_query: string;
  lexical_query: string;
  lexical_aliases?: string[];
}

export type MultilingualQueryProfile = 'default' | 'report';
export type EnglishQueryProfile = 'default' | 'green_deal_regulatory';

const multilingualQuerySchemaProperties: Record<string, unknown> = {
  semantic_query: {
    title: 'SemanticQuery',
    description:
      'Concise primary retrieval query for Chinese or mixed-language corpora. Compress long inputs without broadening scope.',
    type: 'string',
  },
  lexical_query: {
    title: 'LexicalQuery',
    description:
      'Concise keyword-focused lexical query for Chinese or mixed-language corpora. Keep important entities, constraints, official names, abbreviations, and identifiers.',
    type: 'string',
  },
  semantic_query_en: {
    title: 'SemanticQueryEN',
    description:
      'Optional English canonical query when directly useful for retrieval against English corpora.',
    type: ['string', 'null'],
  },
  lexical_query_en: {
    title: 'LexicalQueryEN',
    description:
      'Optional English keyword-focused lexical query when directly useful for retrieval against English corpora.',
    type: ['string', 'null'],
  },
};

export const multilingualQuerySchema: Record<string, unknown> = {
  type: 'object',
  properties: multilingualQuerySchemaProperties,
  required: ['semantic_query', 'lexical_query', 'semantic_query_en', 'lexical_query_en'],
  additionalProperties: false,
};

const englishQuerySchemaProperties: Record<string, unknown> = {
  semantic_query: {
    title: 'SemanticQuery',
    description:
      'Concise English canonical retrieval phrase. Compress long inputs without broadening scope.',
    type: 'string',
  },
  lexical_query: {
    title: 'LexicalQuery',
    description:
      'Concise English keyword-focused retrieval phrase for full-text search. Keep important entities, constraints, official names, abbreviations, and identifiers.',
    type: 'string',
  },
};

export const englishQuerySchema: Record<string, unknown> = {
  type: 'object',
  properties: englishQuerySchemaProperties,
  required: ['semantic_query', 'lexical_query'],
  additionalProperties: false,
};

export const multilingualQueryWithAliasesSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    ...multilingualQuerySchemaProperties,
    lexical_aliases: {
      title: 'LexicalAliases',
      description:
        'Optional narrowly scoped fallback lexical variants for the primary target corpus. Return an empty array when no extra variants are needed.',
      type: 'array',
      items: {
        type: 'string',
      },
    },
    lexical_aliases_en: {
      title: 'LexicalAliasesEN',
      description:
        'Optional narrowly scoped English fallback lexical variants. Return an empty array when no extra variants are needed.',
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: [
    'semantic_query',
    'lexical_query',
    'semantic_query_en',
    'lexical_query_en',
    'lexical_aliases',
    'lexical_aliases_en',
  ],
  additionalProperties: false,
};

export const englishQueryWithAliasesSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    ...englishQuerySchemaProperties,
    lexical_aliases: {
      title: 'LexicalAliases',
      description:
        'Optional narrowly scoped English fallback lexical variants. Return an empty array when no extra variants are needed.',
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['semantic_query', 'lexical_query', 'lexical_aliases'],
  additionalProperties: false,
};

export const CONTROLLED_QUERY_REWRITE_RULES = `
Rewrite rules:
1) Preserve the user's scope, constraints, comparisons, and time references.
2) Do NOT generate synonym lists, answers, explanations, or subqueries.
3) Return retrieval-ready noun phrases only. Do NOT return questions or long explanatory sentences.
4) For lexical queries, keep important entities, modifiers, and constraints in natural order. Do NOT create awkward reordered keyword strings.
5) Keep standard numbers, abbreviations, identifiers, chemical formulas, and official names in the form most likely to appear in the target corpus.
6) Keep semantic queries close to the original wording whenever the original query is already retrieval-ready, but remove question framing and filler words.
7) For paragraph input, compress conservatively into one short retrieval-ready phrase that preserves the target, object, and constraints. Do NOT decompose into subqueries.
8) Return short plain strings only.
9) For relationship questions between named policies, regulations, standards, directives, strategies, or action plans, keep both official names and prefer a concrete linkage phrase such as "<specific document> under <broader framework>" or "<specific document> in the context of <framework>" instead of a vague standalone "relationship" phrase.
`;

const CONTROLLED_LEXICAL_ALIAS_RULES = `
Alias rules:
1) LexicalAliases / LexicalAliasesEN are optional fallback phrases for full-text recall only.
2) Return [] when no narrow fallback phrasing is clearly needed.
3) Return at most 2 aliases per alias field.
4) Keep aliases tightly scoped to the same entity, requirement, risk, or relationship. Do NOT broaden to parent topics.
5) Prefer corpus-native wording variants, official alternate formulations, or chapter-style phrasing.
6) Do NOT repeat SemanticQuery, LexicalQuery, SemanticQueryEN, or LexicalQueryEN.
`;

const MULTILINGUAL_QUERY_PACK_EXAMPLES = `
Examples:
- User: nitrogen and phosphorus removal in wastewater treatment plants
  semantic_query: 污水处理厂脱氮除磷
  lexical_query: 污水处理厂 脱氮 除磷
  semantic_query_en: nitrogen and phosphorus removal in wastewater treatment plants
  lexical_query_en: nitrogen phosphorus removal wastewater treatment plants
- User: 二氧化硫一级浓度限值是多少？
  semantic_query: 二氧化硫一级浓度限值
  lexical_query: 二氧化硫 一级 浓度限值
  semantic_query_en: sulfur dioxide primary concentration limit
  lexical_query_en: sulfur dioxide primary concentration limit
- User: The EU Battery Regulation requires manufacturers to disclose battery carbon footprint, recycled content, due diligence obligations, and end-of-life collection responsibilities for electric vehicle batteries.
  semantic_query: 欧盟电池法规中电动汽车电池碳足迹、再生材料、尽职调查和回收责任要求
  lexical_query: 欧盟电池法规 电动汽车电池 碳足迹 再生材料 尽职调查 回收责任 要求
  semantic_query_en: EU Battery Regulation compliance requirements for electric vehicle batteries covering carbon footprint, recycled content, due diligence, and end-of-life collection
  lexical_query_en: EU Battery Regulation electric vehicle batteries carbon footprint recycled content due diligence end-of-life collection compliance requirements
`;

const ENGLISH_QUERY_PACK_EXAMPLES = `
Examples:
- User: 关键金属物质流的全球贸易特征是什么？
  semantic_query: global trade characteristics of critical metal material flows
  lexical_query: critical metal material flows global trade characteristics
- User: What are the due diligence requirements in the EU Battery Regulation?
  semantic_query: due diligence requirements in the EU Battery Regulation
  lexical_query: due diligence requirements EU Battery Regulation
- User: What is the relationship between the EU Battery Regulation and the Circular Economy Action Plan?
  semantic_query: EU Battery Regulation under the Circular Economy Action Plan
  lexical_query: Circular Economy Action Plan EU Battery Regulation batteries waste batteries
- User: 欧盟新电池法规和循环经济行动计划有什么关系？
  semantic_query: EU Battery Regulation under the Circular Economy Action Plan
  lexical_query: Circular Economy Action Plan EU Battery Regulation batteries waste batteries
- User: What is the impact of the EU Battery Regulation on battery recycling?
  semantic_query: battery recycling provisions in the EU Battery Regulation
  lexical_query: EU Battery Regulation batteries waste batteries recycling collection recycling efficiencies
- User: 欧盟新电池法规对电池回收有什么影响？
  semantic_query: battery recycling provisions in the EU Battery Regulation
  lexical_query: EU Battery Regulation batteries waste batteries recycling collection recycling efficiencies
- User: What batteries are covered by the EU Battery Regulation?
  semantic_query: battery categories covered by the EU Battery Regulation
  lexical_query: EU Battery Regulation portable batteries industrial batteries electric vehicle batteries LMT batteries covered
- User: 欧盟电池法规适用于哪些电池？
  semantic_query: battery categories covered by the EU Battery Regulation
  lexical_query: EU Battery Regulation portable batteries industrial batteries electric vehicle batteries LMT batteries covered
- User: When do the EU Battery Regulation carbon footprint requirements take effect?
  semantic_query: application timeline of carbon footprint requirements in the EU Battery Regulation
  lexical_query: EU Battery Regulation carbon footprint declaration performance classes maximum carbon thresholds timeline
- User: 欧盟电池法规碳足迹要求什么时候生效？
  semantic_query: application timeline of carbon footprint requirements in the EU Battery Regulation
  lexical_query: EU Battery Regulation carbon footprint declaration performance classes maximum carbon thresholds timeline
- User: What are the recycled content requirements in the EU Battery Regulation?
  semantic_query: recycled content requirements for industrial and electric vehicle batteries in the EU Battery Regulation
  lexical_query: EU Battery Regulation recycled content cobalt lead lithium nickel industrial batteries electric vehicle batteries
- User: 欧盟电池法规对再生材料有什么要求？
  semantic_query: recycled content requirements for industrial and electric vehicle batteries in the EU Battery Regulation
  lexical_query: EU Battery Regulation recycled content cobalt lead lithium nickel industrial batteries electric vehicle batteries
- User: The EU Battery Regulation requires manufacturers to disclose battery carbon footprint, recycled content, due diligence obligations, and end-of-life collection responsibilities for electric vehicle batteries.
  semantic_query: EU Battery Regulation compliance requirements for electric vehicle batteries covering carbon footprint, recycled content, due diligence, and end-of-life collection
  lexical_query: EU Battery Regulation electric vehicle batteries carbon footprint recycled content due diligence end-of-life collection compliance requirements
`;

const REPORT_QUERY_ALIAS_PROFILE_EXAMPLES = `
Report profile alias examples:
- User: 海岸洪水和沙质海岸线退缩的趋势
  semantic_query: 海岸洪水和沙质海岸线退缩趋势
  lexical_query: 海岸洪水 沙质海岸线 退缩 趋势
  semantic_query_en: trends of coastal flooding and sandy coastline retreat
  lexical_query_en: coastal flooding sandy coastline retreat trends
  lexical_aliases: ["海岸洪水", "海岸侵蚀"]
  lexical_aliases_en: ["coastal flooding", "coastal erosion"]
- User: 欧洲热浪与干旱风险
  semantic_query: 欧洲热浪干旱风险
  lexical_query: 欧洲 热浪 干旱 风险
  semantic_query_en: heatwave and drought risks in Europe
  lexical_query_en: Europe heatwave drought risks
  lexical_aliases: ["欧洲热浪", "欧洲干旱"]
  lexical_aliases_en: ["European heatwave", "European drought"]
- User: sea level rise impacts on coastal cities
  semantic_query: 海平面上升对沿海城市的影响
  lexical_query: 海平面上升 沿海城市 影响
  semantic_query_en: sea level rise impacts on coastal cities
  lexical_query_en: sea level rise coastal cities impacts
  lexical_aliases: ["海平面上升", "沿海城市"]
  lexical_aliases_en: ["sea level rise", "coastal cities"]
`;

const GREEN_DEAL_QUERY_ALIAS_PROFILE_EXAMPLES = `
Regulatory profile alias examples:
- User: What are the due diligence requirements in the EU Battery Regulation?
  semantic_query: due diligence requirements in the EU Battery Regulation
  lexical_query: due diligence requirements EU Battery Regulation
  lexical_aliases: ["due diligence obligations", "battery supply chain due diligence"]
- User: 欧盟电池法规中的尽职调查要求是什么？
  semantic_query: due diligence requirements in the EU Battery Regulation
  lexical_query: due diligence requirements EU Battery Regulation
  lexical_aliases: ["due diligence obligations", "battery supply chain due diligence"]
`;

type ScriptKind = 'cjk' | 'latin' | 'mixed' | 'neutral';
type ScriptPreference = 'cjk_or_mixed' | 'latin_or_mixed';

const ENGLISH_WORD_PATTERN = /[a-z0-9-]+/gi;

const ENGLISH_QUESTION_REWRITES: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /^(?:please\s+)?what\s+is\s+the\s+relationship\s+between\s+(.+)$/i,
    replacement: 'relationship between $1',
  },
  {
    pattern: /^(?:please\s+)?what\s+(?:is|are)\s+(.+)$/i,
    replacement: '$1',
  },
  {
    pattern: /^(?:please\s+)?(?:which|who|where|when|why)\s+(.+)$/i,
    replacement: '$1',
  },
  {
    pattern:
      /^(?:please\s+)?how\s+(?:to\s+|do\s+|does\s+|can\s+|could\s+|should\s+|would\s+|will\s+)?(.+)$/i,
    replacement: '$1',
  },
  {
    pattern: /^(?:please\s+)?(?:is|are|do|does|did|can|could|should|would|will)\s+(.+)$/i,
    replacement: '$1',
  },
];

const CHINESE_QUESTION_REWRITES: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /^(?:请问一下?|请问|请教一下?|我想了解|我想知道|想了解|想知道|帮我找|帮我查)\s*(.+)$/u,
    replacement: '$1',
  },
  {
    pattern: /^(?:什么是|什么叫|如何|怎么|怎样|为何|为什么)\s*(.+)$/u,
    replacement: '$1',
  },
  {
    pattern: /^(.+?)是什么$/u,
    replacement: '$1',
  },
  {
    pattern: /^(.+?)是多少$/u,
    replacement: '$1',
  },
];

export function buildMultilingualQuerySystemPrompt(options?: {
  profile?: MultilingualQueryProfile;
}): string {
  const profile = options?.profile ?? 'default';

  if (profile === 'report') {
    return `Task: Rewrite the original query into a conservative multilingual retrieval query pack for environmental-domain report search over mostly Chinese or mixed-language corpora.
- SemanticQuery should be the primary retrieval phrase for the target corpus. For English input, translate into concise Chinese or mixed Chinese-English terminology when that clearly improves recall against Chinese corpora.
- LexicalQuery should be a concise keyword-focused full-text query for the same corpus.
- SemanticQueryEN should be a concise English canonical retrieval phrase when useful.
- LexicalQueryEN should be a concise English keyword-focused retrieval phrase when useful.
- LexicalAliases should contain up to 2 narrowly scoped fallback lexical variants for report-style wording when they clearly improve recall; otherwise return [].
- LexicalAliasesEN should contain up to 2 narrowly scoped English fallback lexical variants for report-style wording when they clearly improve recall; otherwise return [].
- For compound risk, trend, or impact queries, prefer short facet anchors that commonly appear independently in report headings or snippets, such as "coastal flooding", "coastal erosion", "sea level rise", or "coastal cities", instead of near-paraphrases of the whole query.
${CONTROLLED_QUERY_REWRITE_RULES}
${CONTROLLED_LEXICAL_ALIAS_RULES}
${MULTILINGUAL_QUERY_PACK_EXAMPLES}
${REPORT_QUERY_ALIAS_PROFILE_EXAMPLES}`;
  }

  return `Task: Rewrite the original query into a conservative multilingual retrieval query pack for environmental-domain search over mostly Chinese or mixed-language corpora.
- SemanticQuery should be the primary retrieval phrase for the target corpus. For English input, translate into concise Chinese or mixed Chinese-English terminology when that clearly improves recall against Chinese corpora.
- LexicalQuery should be a concise keyword-focused full-text query for the same corpus.
- SemanticQueryEN should be a concise English canonical retrieval phrase when useful.
- LexicalQueryEN should be a concise English keyword-focused retrieval phrase when useful.
${CONTROLLED_QUERY_REWRITE_RULES}
${MULTILINGUAL_QUERY_PACK_EXAMPLES}`;
}

export function buildEnglishQuerySystemPrompt(options?: { profile?: EnglishQueryProfile }): string {
  const profile = options?.profile ?? 'default';

  if (profile === 'green_deal_regulatory') {
    return `Task: Rewrite the original query into a conservative English retrieval query pack for environmental-domain regulatory and policy search over English corpora.
- Always output English retrieval phrases, even when the original query is in Chinese or another language.
- SemanticQuery should be a concise English canonical retrieval phrase.
- LexicalQuery should be a concise English keyword-focused retrieval phrase.
- LexicalAliases should contain up to 2 narrowly scoped fallback regulatory phrasing variants when they clearly improve recall; otherwise return [].
${CONTROLLED_QUERY_REWRITE_RULES}
${CONTROLLED_LEXICAL_ALIAS_RULES}
${ENGLISH_QUERY_PACK_EXAMPLES}
${GREEN_DEAL_QUERY_ALIAS_PROFILE_EXAMPLES}`;
  }

  return `Task: Rewrite the original query into a conservative English retrieval query pack for environmental-domain search over English corpora.
- Always output English retrieval phrases, even when the original query is in Chinese or another language.
- SemanticQuery should be a concise English canonical retrieval phrase.
- LexicalQuery should be a concise English keyword-focused retrieval phrase.
${CONTROLLED_QUERY_REWRITE_RULES}
${ENGLISH_QUERY_PACK_EXAMPLES}`;
}

function normalizeQueryText(value: unknown): string {
  if (typeof value !== 'string') {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return value.replace(/\s+/g, ' ').trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizeQueryText(item))
    .filter((item) => item.length > 0);
}

function normalizeCompareKey(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function countEnglishWords(text: string): number {
  const matches = text.match(ENGLISH_WORD_PATTERN);
  return matches ? matches.length : 0;
}

function detectPrimaryScript(text: string): ScriptKind {
  const normalized = normalizeQueryText(text);
  const cjkCount = countMatches(normalized, /[\u3400-\u9fff]/g);
  const latinCount = countMatches(normalized, /[a-z]/gi);

  if (cjkCount === 0 && latinCount === 0) {
    return 'neutral';
  }

  if (cjkCount > 0 && latinCount === 0) {
    return 'cjk';
  }

  if (latinCount > 0 && cjkCount === 0) {
    return 'latin';
  }

  if (cjkCount > latinCount) {
    return 'cjk';
  }

  if (latinCount > cjkCount) {
    return 'latin';
  }

  return 'mixed';
}

function stripWrappingDelimiters(text: string): string {
  return text
    .replace(/^[\s"'`“”‘’()\[\]{}<>【】「」『』]+/g, '')
    .replace(/[\s"'`“”‘’()\[\]{}<>【】「」『』]+$/g, '');
}

function stripTrailingSentencePunctuation(text: string): string {
  return text.replace(/[?？!.。;；:：]+$/g, '').trim();
}

function toRetrievalPhrase(value: string): string {
  let output = normalizeQueryText(value);
  if (!output) {
    return output;
  }

  output = stripWrappingDelimiters(output);
  output = stripTrailingSentencePunctuation(output);

  for (const { pattern, replacement } of ENGLISH_QUESTION_REWRITES) {
    output = output.replace(pattern, replacement).trim();
  }
  output = output.replace(/^(?:the|a|an)\s+/i, '');

  for (const { pattern, replacement } of CHINESE_QUESTION_REWRITES) {
    output = output.replace(pattern, replacement).trim();
  }
  output = output.replace(/^(?:关于|有关)\s*/u, '');

  return normalizeQueryText(stripTrailingSentencePunctuation(output));
}

function sanitizeRetrievalCandidate(candidate: string, fallback = ''): string {
  const normalized = normalizeQueryText(candidate || fallback);
  if (!normalized) {
    return '';
  }

  return toRetrievalPhrase(normalized) || normalizeQueryText(fallback);
}

function isLikelyParagraph(text: string): boolean {
  const normalized = normalizeQueryText(text);
  if (!normalized) {
    return false;
  }

  return (
    normalized.length >= 140 ||
    countEnglishWords(normalized) >= 24 ||
    /[.;:。；：]/.test(normalized)
  );
}

function isInsufficientlyCompressed(candidate: string, userQuery: string): boolean {
  const normalizedCandidate = normalizeQueryText(candidate);
  const normalizedUserQuery = normalizeQueryText(userQuery);

  if (!normalizedCandidate || !normalizedUserQuery || !isLikelyParagraph(normalizedUserQuery)) {
    return false;
  }

  const candidateLengthRatio = normalizedCandidate.length / Math.max(normalizedUserQuery.length, 1);
  const candidateWordCount = countEnglishWords(normalizedCandidate);
  const userWordCount = countEnglishWords(normalizedUserQuery);

  if (candidateLengthRatio >= 0.88) {
    return true;
  }

  if (userWordCount >= 24 && candidateWordCount >= Math.max(18, userWordCount - 3)) {
    return true;
  }

  return /[.;:。；：]/.test(normalizedCandidate);
}

function getScriptPreferenceScore(
  candidateScript: ScriptKind,
  preference?: ScriptPreference,
): number {
  if (preference === 'cjk_or_mixed') {
    if (candidateScript === 'cjk') {
      return 3;
    }
    if (candidateScript === 'mixed') {
      return 2;
    }
    return 0;
  }

  if (preference === 'latin_or_mixed') {
    if (candidateScript === 'latin') {
      return 3;
    }
    if (candidateScript === 'mixed') {
      return 2;
    }
    return -2;
  }

  return 0;
}

function scoreQueryCandidate(
  candidate: string | undefined,
  userQuery: string,
  options?: {
    preferScript?: ScriptPreference;
    blockLatinForCjkSource?: boolean;
  },
): number {
  const normalizedCandidate = normalizeQueryText(candidate);
  if (!normalizedCandidate) {
    return Number.NEGATIVE_INFINITY;
  }

  const sourceScript = detectPrimaryScript(userQuery);
  const candidateScript = detectPrimaryScript(normalizedCandidate);

  let score = 0;
  score += getScriptPreferenceScore(candidateScript, options?.preferScript);

  if (isInsufficientlyCompressed(normalizedCandidate, userQuery)) {
    score -= 4;
  } else {
    score += 4;
  }

  if (
    normalizeCompareKey(normalizedCandidate) === normalizeCompareKey(userQuery) &&
    isLikelyParagraph(userQuery)
  ) {
    score -= 2;
  }

  if (/[.;:。；：]/.test(normalizedCandidate)) {
    score -= 2;
  }

  if (normalizedCandidate.length > 160) {
    score -= 2;
  }

  if (options?.blockLatinForCjkSource && sourceScript === 'cjk' && candidateScript === 'latin') {
    score -= 8;
  }

  return score;
}

function chooseHigherQualityCandidate(
  primary: string,
  alternatives: Array<string | undefined>,
  userQuery: string,
  options?: {
    preferScript?: ScriptPreference;
    blockLatinForCjkSource?: boolean;
  },
): string {
  let bestCandidate = normalizeQueryText(primary);
  let bestScore = scoreQueryCandidate(bestCandidate, userQuery, options);

  for (const alternative of alternatives) {
    const normalizedAlternative = normalizeQueryText(alternative);
    if (!normalizedAlternative) {
      continue;
    }

    const alternativeScore = scoreQueryCandidate(normalizedAlternative, userQuery, options);
    if (alternativeScore > bestScore) {
      bestCandidate = normalizedAlternative;
      bestScore = alternativeScore;
    }
  }

  return bestCandidate;
}

function sanitizeOptionalEnglishQuery(candidate: string, fallback = ''): string | undefined {
  const normalized = sanitizeRetrievalCandidate(candidate || fallback, fallback);
  if (!normalized) {
    return undefined;
  }

  const script = detectPrimaryScript(normalized);
  if (script === 'cjk') {
    return undefined;
  }

  return normalized;
}

function isReasonableLexicalAlias(candidate: string): boolean {
  const normalized = normalizeQueryText(candidate);
  if (!normalized) {
    return false;
  }

  if (normalized.length > 120) {
    return false;
  }

  if (isLikelyParagraph(normalized)) {
    return false;
  }

  if (/[.;:。；：]/.test(normalized)) {
    return false;
  }

  return countEnglishWords(normalized) <= 14;
}

function sanitizeLexicalAliases(
  candidates: unknown,
  options?: {
    englishOnly?: boolean;
    exclude?: Array<string | undefined>;
    maxAliases?: number;
  },
): string[] {
  const excludedKeys = new Set(
    (options?.exclude ?? [])
      .map((candidate) => normalizeCompareKey(normalizeQueryText(candidate ?? '')))
      .filter((key) => key.length > 0),
  );

  const sanitized = dedupeQueryCandidates(
    normalizeStringArray(candidates)
      .map((candidate) =>
        options?.englishOnly
          ? sanitizeOptionalEnglishQuery(candidate)
          : sanitizeRetrievalCandidate(candidate),
      )
      .filter((candidate): candidate is string => Boolean(candidate))
      .filter((candidate) => isReasonableLexicalAlias(candidate))
      .filter((candidate) => !excludedKeys.has(normalizeCompareKey(candidate))),
  );

  return sanitized.slice(0, options?.maxAliases ?? 2);
}

function dedupeQueryCandidates(candidates: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeQueryText(candidate);
    if (!normalized) {
      continue;
    }

    const key = normalizeCompareKey(normalized);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(normalized);
  }

  return out;
}

export function sanitizeMultilingualQueryPack(raw: QueryPack, userQuery: string): QueryPack {
  const normalizedUserQuery = sanitizeRetrievalCandidate(userQuery, userQuery);
  const sourceScript = detectPrimaryScript(normalizedUserQuery);

  let semanticQuery = sanitizeRetrievalCandidate(
    raw.semantic_query || normalizedUserQuery,
    normalizedUserQuery,
  );
  let lexicalQuery = sanitizeRetrievalCandidate(
    raw.lexical_query || semanticQuery || normalizedUserQuery,
    semanticQuery || normalizedUserQuery,
  );

  let semanticQueryEn = sanitizeOptionalEnglishQuery(
    raw.semantic_query_en || '',
    sourceScript === 'latin' ? semanticQuery : '',
  );
  let lexicalQueryEn = sanitizeOptionalEnglishQuery(
    raw.lexical_query_en || '',
    sourceScript === 'latin' ? lexicalQuery : semanticQueryEn || '',
  );

  semanticQuery = chooseHigherQualityCandidate(
    semanticQuery,
    [semanticQueryEn, lexicalQueryEn],
    normalizedUserQuery,
    { preferScript: 'cjk_or_mixed', blockLatinForCjkSource: true },
  );
  lexicalQuery = chooseHigherQualityCandidate(
    lexicalQuery,
    [semanticQuery, lexicalQueryEn, semanticQueryEn],
    normalizedUserQuery,
    { preferScript: 'cjk_or_mixed', blockLatinForCjkSource: true },
  );

  if (sourceScript === 'cjk' && detectPrimaryScript(semanticQuery) === 'latin') {
    semanticQuery = normalizedUserQuery;
  }
  if (sourceScript === 'cjk' && detectPrimaryScript(lexicalQuery) === 'latin') {
    lexicalQuery = semanticQuery || normalizedUserQuery;
  }

  semanticQueryEn = sanitizeOptionalEnglishQuery(
    semanticQueryEn || '',
    sourceScript === 'latin' ? semanticQuery : '',
  );
  lexicalQueryEn = sanitizeOptionalEnglishQuery(
    lexicalQueryEn || '',
    sourceScript === 'latin' ? lexicalQuery : semanticQueryEn || '',
  );

  const lexicalAliases = sanitizeLexicalAliases(raw.lexical_aliases, {
    exclude: [lexicalQuery, semanticQuery, lexicalQueryEn, semanticQueryEn],
  });
  const lexicalAliasesEn = sanitizeLexicalAliases(raw.lexical_aliases_en, {
    englishOnly: true,
    exclude: [lexicalQuery, semanticQuery, lexicalQueryEn, semanticQueryEn, ...lexicalAliases],
  });

  return {
    semantic_query: semanticQuery || normalizedUserQuery,
    lexical_query: lexicalQuery || semanticQuery || normalizedUserQuery,
    ...(semanticQueryEn ? { semantic_query_en: semanticQueryEn } : {}),
    ...(lexicalQueryEn ? { lexical_query_en: lexicalQueryEn } : {}),
    ...(lexicalAliases.length > 0 ? { lexical_aliases: lexicalAliases } : {}),
    ...(lexicalAliasesEn.length > 0 ? { lexical_aliases_en: lexicalAliasesEn } : {}),
  };
}

export function sanitizeEnglishQueryPack(
  raw: EnglishQueryPack,
  userQuery: string,
): EnglishQueryPack {
  const normalizedUserQuery = sanitizeRetrievalCandidate(userQuery, userQuery);
  let semanticQuery = sanitizeRetrievalCandidate(
    raw.semantic_query || normalizedUserQuery,
    normalizedUserQuery,
  );
  let lexicalQuery = sanitizeRetrievalCandidate(
    raw.lexical_query || semanticQuery || normalizedUserQuery,
    semanticQuery || normalizedUserQuery,
  );

  semanticQuery = chooseHigherQualityCandidate(semanticQuery, [lexicalQuery], normalizedUserQuery, {
    preferScript: 'latin_or_mixed',
  });
  lexicalQuery = chooseHigherQualityCandidate(lexicalQuery, [semanticQuery], normalizedUserQuery, {
    preferScript: 'latin_or_mixed',
  });

  const lexicalAliases = sanitizeLexicalAliases(raw.lexical_aliases, {
    englishOnly: true,
    exclude: [lexicalQuery, semanticQuery],
  });

  return {
    semantic_query: semanticQuery || normalizedUserQuery,
    lexical_query: lexicalQuery || semanticQuery || normalizedUserQuery,
    ...(lexicalAliases.length > 0 ? { lexical_aliases: lexicalAliases } : {}),
  };
}

export function buildLexicalQueryCandidates(
  queryPack: QueryPack | EnglishQueryPack,
  options?: {
    maxQueries?: number;
    includeAliases?: boolean;
    includeSemantic?: boolean;
  },
): string[] {
  const maxQueries = options?.maxQueries ?? 4;
  const includeSemantic = options?.includeSemantic ?? true;
  const aliasCandidates = options?.includeAliases
    ? [
        ...(queryPack.lexical_aliases ?? []),
        ...('lexical_aliases_en' in queryPack ? (queryPack.lexical_aliases_en ?? []) : []),
      ]
    : [];

  const candidates = dedupeQueryCandidates([
    queryPack.lexical_query,
    includeSemantic ? queryPack.semantic_query : undefined,
    'lexical_query_en' in queryPack ? (queryPack.lexical_query_en ?? undefined) : undefined,
    includeSemantic && 'semantic_query_en' in queryPack
      ? (queryPack.semantic_query_en ?? undefined)
      : undefined,
    ...aliasCandidates,
  ]);

  return candidates.slice(0, maxQueries);
}

export function isLikelyParagraphQuery(query: string): boolean {
  const normalized = normalizeQueryText(query);
  return normalized.length >= 140 || normalized.split(/[。！？.!?]/).filter(Boolean).length >= 2;
}

export function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

export function containsLatin(text: string): boolean {
  return /[a-z]/i.test(text);
}
