import { Router } from "express";
import authRouterV1 from "./auth.route";
import vehiclesRouterV1 from "./vehicles.route";

const rootRouterV1: Router = Router();

rootRouterV1.use("/auth", authRouterV1);
rootRouterV1.use("/vehicles", vehiclesRouterV1);

export default rootRouterV1;
