import { Router } from "express";
import { errorHandler } from "../../error-handler";
import { changePassword, login, logout, logoutAllDevices, reset2FAOnly, setPasswordLogin, signup, verify2FALogin, verifyAndEnable2FALogin, otpRequest, otpVerify, me, updateMe, updateMyPhoto, removeMyPhoto, changeMyPassword } from "../controllers/auth.controller";
import { setup2FA, verifyAndEnable2FA, disable2FA } from "../controllers/two-factor.controller";
import { employeeUpload, profilePhotoUpload } from "../middlewares/multer.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { authMiddleware } from "../middlewares/auth.middleware";

const authRouterV1: Router = Router();

authRouterV1.post("/signup", employeeUpload.any(), errorHandler(signup));
authRouterV1.post("/login", errorHandler(login));
authRouterV1.post("/otp/request", errorHandler(otpRequest));
authRouterV1.post("/otp/verify", errorHandler(otpVerify));
authRouterV1.post("/verify-2fa", errorHandler(verify2FALogin));
authRouterV1.post("/verify-2fa-setup", errorHandler(verifyAndEnable2FALogin));
authRouterV1.post("/set-password", errorHandler(setPasswordLogin));
authRouterV1.post("/logout", errorHandler(logout));
authRouterV1.get("/me", authMiddleware, errorHandler(me));
authRouterV1.patch("/me", authMiddleware, errorHandler(updateMe));
// Signed in first, so an anonymous upload never reaches the disk.
authRouterV1.put("/me/photo", authMiddleware, profilePhotoUpload.single("photo"), errorHandler(updateMyPhoto));
authRouterV1.delete("/me/photo", authMiddleware, errorHandler(removeMyPhoto));
authRouterV1.post("/me/password", authMiddleware, errorHandler(changeMyPassword));
authRouterV1.post("/logout-all-devices", authMiddleware, errorHandler(logoutAllDevices));
authRouterV1.post("/reset-2fa/:userId", [authMiddleware, requirePermission(["user_password:manage"])], errorHandler(reset2FAOnly));
authRouterV1.put("/change-password/:userId", [authMiddleware, requirePermission(["user_password:manage"])], errorHandler(changePassword));

// 2FA Routes
authRouterV1.get("/2fa/setup", authMiddleware, errorHandler(setup2FA));
authRouterV1.post("/2fa/verify", authMiddleware, errorHandler(verifyAndEnable2FA));
authRouterV1.post("/2fa/disable", authMiddleware, errorHandler(disable2FA));



export default authRouterV1;