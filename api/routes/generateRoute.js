import { Router } from "express";
import { generateAddress } from "../controllers/generate.js";

const generateRouter = Router();

generateRouter.post('/', generateAddress);

export default generateRouter;
