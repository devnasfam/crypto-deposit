import { Router } from "express";
import { generate } from "../controllers/generate.js";

const generateRouter = Router();

generateRouter.post('/', generate);

export default generateRouter;
