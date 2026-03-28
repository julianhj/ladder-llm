/**
 * Public HTTP surface: Hono app + Chanfana OpenAPI registry (validated routes + Swagger + openapi.json).
 */
import { ApiException, fromHono } from "chanfana";
import { Hono } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { HealthEndpoint } from "./endpoints/health";
import { recruitmentRouter } from "./endpoints/router";
import { verifyCloudflareAccessRequest } from "./verifyCloudflareAccess";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
	if (err instanceof ApiException) {
		return c.json(
			{ success: false, errors: err.buildResponse() },
			err.status as ContentfulStatusCode,
		);
	}

	console.error("Global error handler caught:", err);

	return c.json(
		{
			success: false,
			errors: [{ code: 7000, message: "Internal Server Error" }],
		},
		500,
	);
});

app.use("*", async (c, next) => {
	if (c.req.method === "GET" && c.req.path === "/health") {
		return next();
	}
	if (!(await verifyCloudflareAccessRequest(c.req.raw, c.env))) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return next();
});

const openapi = fromHono(app, {
	docs_url: "/docs",
	openapi_url: "/openapi.json",
	openapiVersion: "3.1",
	schema: {
		info: {
			title: "Ladder LLM API",
			version: "1.0.0",
			description: "Cloudflare Worker API for the recruitment assessment pipeline.",
		},
		tags: [
			{ name: "Health", description: "Liveness" },
			{ name: "Agents", description: "Agent discovery from embedded config" },
			{ name: "Assessment", description: "Run the recruitment assessment pipeline" },
		],
	},
});

openapi.route("/", recruitmentRouter);
openapi.get("/health", HealthEndpoint);

app.get("/", (c) => c.redirect("/docs", 302));

export default app;
