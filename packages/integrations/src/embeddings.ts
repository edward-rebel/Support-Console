import OpenAI from "openai";
import { EMBEDDING_DIMENSIONS } from "@ms/shared";
import type { IntegrationsConfig } from "./config";
import { MODELS } from "./ai";

// The embeddings provider seam (spec §4): swap the implementation here without
// touching the knowledge layer. Returns one vector per input text, in order.
export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

// OpenAI text-embedding-3-small (1536 dims). The default `dimensions` of this
// model already matches EMBEDDING_DIMENSIONS, so we don't pass the param.
class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = MODELS.embeddings.openai;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.client.embeddings.create({
      model: this.modelId,
      input: texts,
    });
    // The API returns objects with an `index` field; sort defensively so the
    // output order always matches the input order.
    return res.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding as number[]);
  }
}

// Embeddings reuse the OpenAI key by default but can be pointed at a dedicated
// EMBEDDINGS_API_KEY for a different account/provider.
export function embeddingsApiKey(cfg: IntegrationsConfig): string | undefined {
  return cfg.embeddingsApiKey ?? cfg.openaiApiKey;
}

export function hasEmbeddingProvider(cfg: IntegrationsConfig): boolean {
  return Boolean(embeddingsApiKey(cfg));
}

export function makeEmbeddingProvider(
  cfg: IntegrationsConfig,
): EmbeddingProvider | null {
  const key = embeddingsApiKey(cfg);
  return key ? new OpenAIEmbeddingProvider(key) : null;
}
