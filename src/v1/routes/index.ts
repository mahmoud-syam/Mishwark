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

const rootRouterV1: Router = Router();

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

export default rootRouterV1;
