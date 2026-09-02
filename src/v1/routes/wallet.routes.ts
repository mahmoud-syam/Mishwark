import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  getBalance,
  getTransactions,
  creditWallet,
  debitWallet,
} from "../controllers/wallet.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const walletRouter: Router = Router();

walletRouter.get("/balance", authMiddleware, errorHandler(getBalance));
walletRouter.get("/transactions", authMiddleware, errorHandler(getTransactions));
walletRouter.post("/credit", authMiddleware, errorHandler(creditWallet));
walletRouter.post("/debit", authMiddleware, errorHandler(debitWallet));

export default walletRouter;
