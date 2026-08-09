import {
    Packages,
    Payments,
    Reviews,
    Waitlist,
    Conversations,
    Messages,
    ScheduledNotifications,
    Referrals,
    WalletTransactions,
    TripLocations,
    VehicleMaintenance,
    PrismaClient,
    PackageType,
    PackageStatus,
    PaymentMethod,
    PaymentRecordStatus,
    ReviewerType,
    WaitlistStatus,
    ConversationStatus,
    SenderType,
    MessageType,
    NotificationRecipientType,
    NotificationType,
    NotificationChannel,
    NotificationStatus,
    ReferralStatus,
    WalletTransactionType
} from "@prisma/client";

import prismaClient from "../src/v1/utils/prismaClientHelper";

// 1. Verify Prisma Client Query Delegates exist
function verifyQueryDelegates(client: PrismaClient) {
    const delegates = [
        { name: "packages", delegate: client.packages },
        { name: "payments", delegate: client.payments },
        { name: "reviews", delegate: client.reviews },
        { name: "waitlist", delegate: client.waitlist },
        { name: "conversations", delegate: client.conversations },
        { name: "messages", delegate: client.messages },
        { name: "scheduledNotifications", delegate: client.scheduledNotifications },
        { name: "referrals", delegate: client.referrals },
        { name: "walletTransactions", delegate: client.walletTransactions },
        { name: "tripLocations", delegate: client.tripLocations },
        { name: "vehicleMaintenance", delegate: client.vehicleMaintenance },
    ];

    console.log("Checking 11 Prisma query delegates...");
    for (const d of delegates) {
        if (!d.delegate) {
            throw new Error(`Prisma Client delegate '${d.name}' is missing!`);
        }
        if (typeof d.delegate.findMany !== "function") {
            throw new Error(`Delegate '${d.name}' does not have findMany function!`);
        }
        if (typeof d.delegate.create !== "function") {
            throw new Error(`Delegate '${d.name}' does not have create function!`);
        }
        console.log(`  [OK] ${d.name} query delegate verified.`);
    }
}

// 2. Type Assertions for Model Interfaces
type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

function testTypeExports() {
    // Packages type validation
    const pkg: Packages = {
        id: "pkg-1",
        customerId: "cust-1",
        packageName: "Gold Package",
        packageType: PackageType.MULTI_CAR,
        totalPrice: 500,
        discountPercentage: 10,
        status: PackageStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // Payments type validation
    const payment: Payments = {
        id: "pay-1",
        bookingId: "book-1",
        userId: "user-1",
        amount: 150,
        paymentMethod: PaymentMethod.PAYMOB,
        transactionRef: "TXN123",
        status: PaymentRecordStatus.SUCCESS,
        paidAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // Reviews type validation
    const review: Reviews = {
        id: "rev-1",
        bookingId: "book-1",
        reviewerId: "user-1",
        revieweeId: "driver-1",
        reviewerType: ReviewerType.CUSTOMER_TO_DRIVER,
        overallRating: 5,
        vehicleRating: 5,
        punctualityRating: 5,
        comment: "Great trip!",
        visibleAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // Waitlist type validation
    const waitlist: Waitlist = {
        id: "wait-1",
        customerId: "cust-1",
        vehicleId: "veh-1",
        bookingId: null,
        requestedDate: "2026-08-10",
        requestedTime: "10:00",
        position: 1,
        status: WaitlistStatus.WAITING,
        notifiedAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // Conversations type validation
    const conv: Conversations = {
        id: "conv-1",
        bookingId: "book-1",
        customerId: "cust-1",
        driverId: "driver-1",
        status: ConversationStatus.OPEN,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // Messages type validation
    const msg: Messages = {
        id: "msg-1",
        conversationId: "conv-1",
        senderId: "cust-1",
        senderType: SenderType.CUSTOMER,
        messageType: MessageType.TEXT,
        content: "Where are you?",
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // ScheduledNotifications type validation
    const notif: ScheduledNotifications = {
        id: "notif-1",
        bookingId: "book-1",
        recipientId: "cust-1",
        recipientType: NotificationRecipientType.CUSTOMER,
        notificationType: NotificationType.REMINDER_2H,
        channel: NotificationChannel.PUSH,
        title: "Trip Reminder",
        body: "Your trip starts in 2 hours",
        scheduledAt: new Date(),
        sentAt: null,
        status: NotificationStatus.SCHEDULED,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // Referrals type validation
    const ref: Referrals = {
        id: "ref-1",
        referrerId: "user-1",
        referredId: "user-2",
        referralCode: "REF123",
        status: ReferralStatus.PENDING,
        rewardAmount: 50,
        triggeringBookingId: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // WalletTransactions type validation
    const walletTx: WalletTransactions = {
        id: "wtx-1",
        userId: "user-1",
        amount: 50,
        type: WalletTransactionType.REFERRAL_REWARD,
        description: "Referral bonus",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    // TripLocations type validation
    const tripLoc: TripLocations = {
        id: "loc-1",
        bookingId: "book-1",
        latitude: 30.0444,
        longitude: 31.2357,
        speed: 60,
        recordedAt: new Date(),
    };

    // VehicleMaintenance type validation
    const vm: VehicleMaintenance = {
        id: "vm-1",
        vehicleId: "veh-1",
        maintenanceType: "Oil Change",
        cost: 200,
        scheduledDate: new Date(),
        completedDate: null,
        notes: "Routine maintenance",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    console.log("All 11 TypeScript model types and values successfully instantiated.");
}

async function main() {
    console.log("--- M1 Verification & Stress Test Suite ---");
    verifyQueryDelegates(prismaClient);
    testTypeExports();
    console.log("--- ALL CHECKS PASSED SUCCESSFULLY ---");
}

main().catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
});
