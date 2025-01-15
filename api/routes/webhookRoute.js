import { Router } from "express";
import { handleDepositWebhook } from "../controllers/webhook.js";

const webhookRouter = Router();

webhookRouter.post('/', handleDepositWebhook);

export default webhookRouter;