import { Router } from "express";
import { webhook } from "../controllers/webhook.js";

const webhookRouter = Router();

webhookRouter.post('/', webhook);

export default webhookRouter;