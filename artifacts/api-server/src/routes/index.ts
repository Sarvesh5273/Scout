import { Router, type IRouter } from "express";
import healthRouter from "./health";
import huntsRouter from "./hunts";
import listingsRouter from "./listings";
import metaRouter from "./meta";
import runsRouter from "./runs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(metaRouter);
router.use(huntsRouter);
router.use(runsRouter);
router.use(listingsRouter);

export default router;
