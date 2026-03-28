import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

export class HealthEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Health"],
		summary: "Liveness check",
		operationId: "health",
		responses: {
			"200": {
				description: "Service is healthy",
				...contentJson(z.object({ status: z.literal("ok") })),
			},
		},
	};

	public async handle(_c: AppContext) {
		return { status: "ok" as const };
	}
}
