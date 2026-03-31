import { runStructuredOpenAITask } from './openai_structured_task.ts';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function buildTopicContextUserPrompt(topic: string, context: string): string {
  return `The following context is related to "${topic}".\n\nContext:\n${context}`;
}

const ONTOLOGY_EXTRACTION_SYSTEM_PROMPT = `You are an expert in network graph generation, specializing in extracting terms and their relationships from a given context with precision.
Your task is to extract all ontological terms and their relations from the provided context, ensuring thoroughness and accuracy.
The extracted terms should represent the key and specific concepts in the topic.

Guidelines for extraction:
1. While analyzing the text, focus on identifying key terms in each sentence.
- Terms must be closely related to the provided topic, which should be professional nouns.
- Terms should be simple and specific. Avoid over-generalizing.
- Consider every type of concept mentioned, such as concrete objects, abstract ideas, names, places, and events.
2. Think about the relationships between the identified terms:
- Terms appearing in the same sentence, paragraph, or context are often related.
- Be thorough in identifying one-to-one, one-to-many, and many-to-many relationships between terms.
- Relations may include 'is a type of', 'is part of', 'is associated with', 'causes', 'depends on', etc.
3. Translate all the terms and relationships to the same language as the input topic.

Return all extracted terms and their relations in a structured JSON format.
Each pair of related terms should be output with its relationship.`;

export interface ExtractedTuple {
  start_node: string;
  end_node: string;
  edge: string;
}

export interface OntologyTupleResponse {
  tuples: ExtractedTuple[];
}

export const ontologyTupleSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  description:
    'A list of tuples containing a pair of start and end nodes, and the edge between nodes in the same language as the topic',
  properties: {
    tuples: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        description:
          'A tuple with specific start node, end node and their relationship in the same language as the topic.',
        properties: {
          start_node: {
            type: 'string',
            description: 'A concept from extracted ontology',
          },
          end_node: {
            type: 'string',
            description: 'A related concept from extracted ontology',
          },
          edge: {
            type: 'string',
            description:
              'A relationship between the corresponding concepts of start_node and end_node in one simple phrase',
          },
        },
        required: ['start_node', 'end_node', 'edge'],
      },
    },
  },
  required: ['tuples'],
};

export interface KnowledgeGraphNode {
  name: string;
  node_id: string;
  children: KnowledgeGraphNode[];
}

export interface KnowledgeGraphRelation {
  relation_name: string;
  source_node_id: string;
  target_node_id: string;
}

export interface KnowledgeGraphResponse {
  name: string;
  node_id: string;
  children: KnowledgeGraphNode[];
  relations: KnowledgeGraphRelation[];
}

export const knowledgeGraphSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  description:
    'Schema for the response containing extracted terms and their relationships from a given context in the same language as input topic, ensuring the generated result is a tree structure with two more levels (at most 6).',
  properties: {
    name: {
      type: 'string',
      description: 'The name of the node, which is the extracted term.',
    },
    node_id: {
      type: 'string',
      description: 'The unique identifier for the node.',
    },
    children: {
      type: 'array',
      description: 'This is an array of child nodes, allowing for a hierarchical structure.',
      items: {
        $ref: '#/$defs/node',
      },
    },
    relations: {
      type: 'array',
      description:
        'List of relationships between the corresponding concepts associated with the node',
      items: {
        $ref: '#/$defs/relation',
      },
    },
  },
  required: ['name', 'node_id', 'children', 'relations'],
  $defs: {
    node: {
      type: 'object',
      additionalProperties: false,
      description: 'Schema for a child node.',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the child node.',
        },
        node_id: {
          type: 'string',
          description: 'The unique identifier for the child node.',
        },
        children: {
          type: 'array',
          description: 'List of child nodes of this node.',
          items: {
            $ref: '#/$defs/node',
          },
        },
      },
      required: ['name', 'node_id', 'children'],
    },
    relation: {
      type: 'object',
      additionalProperties: false,
      description: 'Schema for a relationship between nodes.',
      properties: {
        relation_name: {
          type: 'string',
          description: 'The name of the relationship.',
        },
        source_node_id: {
          type: 'string',
          description: 'The unique identifier for the source node in the relationship.',
        },
        target_node_id: {
          type: 'string',
          description: 'The unique identifier for the target node in the relationship.',
        },
      },
      required: ['relation_name', 'source_node_id', 'target_node_id'],
    },
  },
};

export interface QuestionGenerationResponse {
  What: string[];
  Why: string[];
  Where: string[];
  When: string[];
  Who: string[];
  How: string[];
}

export const questionGenerationSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    What: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    Why: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    Where: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    When: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    Who: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    How: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['What', 'Why', 'Where', 'When', 'Who', 'How'],
};

export async function generateOntologyTuples(
  context: string,
  topic: string,
): Promise<OntologyTupleResponse> {
  const normalizedContext = normalizeText(context);
  const normalizedTopic = normalizeText(topic);

  return await runStructuredOpenAITask<OntologyTupleResponse>({
    schemaName: 'info_extract_response',
    schema: ontologyTupleSchema,
    systemPrompt: ONTOLOGY_EXTRACTION_SYSTEM_PROMPT,
    userPrompt: buildTopicContextUserPrompt(normalizedTopic, normalizedContext),
  });
}

export async function generateKnowledgeGraph(
  context: string,
  topic: string,
): Promise<KnowledgeGraphResponse> {
  const normalizedContext = normalizeText(context);
  const normalizedTopic = normalizeText(topic);

  return await runStructuredOpenAITask<KnowledgeGraphResponse>({
    schemaName: 'kg_generate_response',
    schema: knowledgeGraphSchema,
    systemPrompt: `${ONTOLOGY_EXTRACTION_SYSTEM_PROMPT}\nTranslated into Chinese.`,
    userPrompt: buildTopicContextUserPrompt(normalizedTopic, normalizedContext),
  });
}

export async function generatePerspectiveQuestions(
  perspective: string,
): Promise<QuestionGenerationResponse> {
  const normalizedPerspective = normalizeText(perspective);

  return await runStructuredOpenAITask<QuestionGenerationResponse>({
    schemaName: 'question_generation_response',
    schema: questionGenerationSchema,
    systemPrompt:
      'Generate 10 questions in the same language as the perspective for each perspective: What, Why, Where, When, Who, and How.',
    userPrompt: `Perspective: ${normalizedPerspective}`,
  });
}
