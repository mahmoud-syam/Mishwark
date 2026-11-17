import prismaClient from "../utils/prismaClientHelper";
import {
  WalletTransactionType,
} from "../../../generated/prisma";
import {
  BadRequestException,
} from "../utils/errors";

export class WalletService {
  public static async getBalance(userId: string) {
    const result = await prismaClient.walletTransactions.aggregate({
      where: { userId },
      _sum: { amount: true },
    });

    return { balance: result._sum.amount || 0 };
  }

  public static async getTransactions(
    userId: string,
    params: { page?: number; limit?: number; type?: WalletTransactionType }
  ) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (params.type) where.type = params.type;

    const [items, total] = await Promise.all([
      prismaClient.walletTransactions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prismaClient.walletTransactions.count({ where }),
    ]);

    return {
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  public static async creditWallet(
    userId: string,
    amount: number,
    type: WalletTransactionType,
    description?: string
  ) {
    if (amount <= 0) {
      throw new BadRequestException("Credit amount must be positive");
    }

    const transaction = await prismaClient.walletTransactions.create({
      data: {
        userId,
        amount,
        type,
        description,
      },
    });

    return transaction;
  }

  public static async debitWallet(
    userId: string,
    amount: number,
    type: WalletTransactionType,
    description?: string
  ) {
    if (amount <= 0) {
      throw new BadRequestException("Debit amount must be positive");
    }

    const balance = await this.getBalance(userId);
    if (balance.balance < amount) {
      throw new BadRequestException("Insufficient wallet balance");
    }

    const transaction = await prismaClient.walletTransactions.create({
      data: {
        userId,
        amount: -amount,
        type,
        description,
      },
    });

    return transaction;
  }
}

export default WalletService;
