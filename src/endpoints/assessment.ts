import {
	buildAssessmentDisplayDocument,
	main,
	type RecruitmentRequest,
} from "../recruitment/index.js";
import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { installOpenAiKey, installResourceProvider } from "./setupOpenAi";

/** Core required fields; additional RecruitmentRequest fields pass through. */
const recruitmentRequestBody = z
	.object({
		candidate_name: z.string(),
		candidate_email: z.string(),
		company_name: z.string(),
		role_applying_for: z.string(),
		job_description: z.string(),
	})
	.passthrough();

export class AssessmentCreate extends OpenAPIRoute {
	public schema = {
		tags: ["Assessment"],
		summary: "Run the recruitment assessment pipeline",
		operationId: "createAssessment",
		request: {
			body: contentJson(recruitmentRequestBody),
		},
		responses: {
			"200": {
				description: "Pipeline result and display document",
				...contentJson(
					z.object({
						result: z.unknown(),
						assessmentDisplayDocument: z.unknown(),
					}),
				),
			},
		},
	};

	public async handle(c: AppContext) {
		installResourceProvider();
		installOpenAiKey(c.env);
		const data = await this.getValidatedData<typeof this.schema>();
		const payload = data.body as RecruitmentRequest;
		const correlationToken = crypto.randomUUID();
		const result = await main(payload, { correlationToken, sessionToken: null });
		const assessmentId = result.metadata.correlationToken;
		const assessmentDisplayDocument = buildAssessmentDisplayDocument(result, { assessmentId });
		return { result, assessmentDisplayDocument };
	}
}
