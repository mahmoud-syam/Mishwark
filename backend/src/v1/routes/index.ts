import { Router } from "express";
import authRouterV1 from "./auth.route";
import vehiclesRouterV1 from "./vehicles.route";
import bookingRouter from "./booking.routes";
import driverRouter from "./driver.routes";
import reviewRouter from "./review.routes";
import paymentRouter from "./payment.routes";
import waitlistRouter from "./waitlist.routes";
import packageRouter from "./package.routes";
import chatRouter from "./chat.routes";
import referralRouter from "./referral.routes";
import walletRouter from "./wallet.routes";
import notificationRouter from "./notification.routes";
import adminRouter from "./admin.routes";
import placesRouter from "./places.routes";
import pricingRouter from "./pricing.routes";
import deviceRouter from "./device.routes";
import prismaClient from "../utils/prismaClientHelper";

const rootRouterV1: Router = Router();

// Health check for the server's deploy script, the container and uptime
// monitors: is the API up, can it reach the database, which build is running.
const startedAt = new Date();
rootRouterV1.get("/health", async (_req, res) => {
  try {
    await prismaClient.$queryRaw`SELECT 1`;
    res.json({ ok: true, version: process.env.APP_VERSION || "dev", startedAt });
  } catch {
    res.status(503).json({ ok: false, version: process.env.APP_VERSION || "dev", error: "database unreachable" });
  }
});

rootRouterV1.use("/auth", authRouterV1);
rootRouterV1.use("/vehicles", vehiclesRouterV1);
rootRouterV1.use("/bookings", bookingRouter);
rootRouterV1.use("/driver", driverRouter);
rootRouterV1.use("/reviews", reviewRouter);
rootRouterV1.use("/payments", paymentRouter);
rootRouterV1.use("/waitlist", waitlistRouter);
rootRouterV1.use("/packages", packageRouter);
rootRouterV1.use("/chat", chatRouter);
rootRouterV1.use("/referrals", referralRouter);
rootRouterV1.use("/wallet", walletRouter);
rootRouterV1.use("/notifications", notificationRouter);
rootRouterV1.use("/admin", adminRouter);
rootRouterV1.use("/places", placesRouter);
rootRouterV1.use("/pricing", pricingRouter);
rootRouterV1.use("/devices", deviceRouter);

export default rootRouterV1;
