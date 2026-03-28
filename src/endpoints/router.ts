import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AgentsList } from "./agents";
import { AssessmentCreate } from "./assessment";

export const recruitmentRouter = fromHono(new Hono<{ Bindings: Env }>());

recruitmentRouter.get("/agents", AgentsList);
recruitmentRouter.post("/assessment", AssessmentCreate);
