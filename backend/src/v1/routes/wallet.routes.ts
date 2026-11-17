import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  getBalance,
  getTransactions,
  creditWallet,
  debitWallet,
} from "../controllers/wallet.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { PERMISSIONS } from "../constants/roles";

const walletRouter: Router = Router();

const canAdjustWallet = requirePermission(PERMISSIONS.WALLET_MANAGE);

walletRouter.get("/balance", authMiddleware, errorHandler(getBalance));
walletRouter.get("/transactions", authMiddleware, errorHandler(getTransactions));
// Mutating a balance is an administrative action: without this gate any
// authenticated customer or driver could credit or debit any wallet.
walletRouter.post("/credit", authMiddleware, canAdjustWallet, errorHandler(creditWallet));
walletRouter.post("/debit", authMiddleware, canAdjustWallet, errorHandler(debitWallet));

export default walletRouter;
