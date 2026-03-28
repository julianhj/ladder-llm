import { setOpenAiResourceProvider } from "../recruitment/index.js";
import { getEmbeddedConfigJson, getEmbeddedPromptText } from "../generated/openai-assets";

export const defaultCatalog = {
	role: "agent",
	expertise: ["General Assessment"],
	available_tasks: ["Process candidate data"],
	description: "General recruitment pipeline agent",
	instructions: "Process the provided information and deliver high-quality results.",
};

export function installResourceProvider(): void {
	setOpenAiResourceProvider({
		async getConfigJson(name) {
			return getEmbeddedConfigJson(name);
		},
		async getPromptText(relativePath) {
			return getEmbeddedPromptText(relativePath);
		},
	});
}

export function installOpenAiKey(env: Env): void {
	const globalScope = globalThis as unknown as { process?: { env?: Record<string, string> } };
	if (!globalScope.process) globalScope.process = { env: {} };
	if (!globalScope.process.env) globalScope.process.env = {};
	globalScope.process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
}
