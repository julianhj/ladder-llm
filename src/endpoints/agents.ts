import { ConfigLoader } from "../recruitment/index.js";
import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { defaultCatalog, installOpenAiKey, installResourceProvider } from "./setupOpenAi";

export class AgentsList extends OpenAPIRoute {
	public schema = {
		tags: ["Agents"],
		summary: "List recruitment agents from embedded config",
		operationId: "listAgents",
		responses: {
			"200": {
				description: "Agent catalog for discovery",
				...contentJson(
					z.object({
						agents: z.record(z.unknown()),
						total_count: z.number(),
						discovery_timestamp: z.string(),
					}),
				),
			},
		},
	};

	public async handle(c: AppContext) {
		installResourceProvider();
		installOpenAiKey(c.env);
		const agentsConfig = await ConfigLoader.loadAgentsConfig();
		const agents: Record<string, unknown> = {};
		agentsConfig.stages.forEach((stage) => {
			stage.agents.forEach((agentConfig) => {
				const catalog = agentConfig.catalog ?? defaultCatalog;
				agents[agentConfig.id] = {
					id: agentConfig.id,
					name: agentConfig.name,
					role: catalog.role,
					expertise: catalog.expertise,
					available_tasks: catalog.available_tasks,
					description: catalog.description,
					instructions: catalog.instructions,
				};
			});
		});
		return {
			agents,
			total_count: Object.keys(agents).length,
			discovery_timestamp: new Date().toISOString(),
		};
	}
}
