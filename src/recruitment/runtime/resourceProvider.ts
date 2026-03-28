export interface OpenAiResourceProvider {
  getConfigJson?(name: "agents" | "openai"): Promise<string | null>;
  getPromptText?(relativePath: string): Promise<string | null>;
}

let provider: OpenAiResourceProvider | null = null;

export function setOpenAiResourceProvider(nextProvider: OpenAiResourceProvider | null): void {
  provider = nextProvider;
}

export function getOpenAiResourceProvider(): OpenAiResourceProvider | null {
  return provider;
}
