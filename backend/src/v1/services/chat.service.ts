import prismaClient from "../utils/prismaClientHelper";
import {
  ConversationStatus,
  SenderType,
  MessageType,
} from "../../../generated/prisma";
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "../utils/errors";

export class ChatService {
  public static async getOrCreateConversation(bookingId: string, userId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
      include: { driver: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    let conversation = await prismaClient.conversations.findUnique({
      where: { bookingId },
    });

    if (conversation) return conversation;

    conversation = await prismaClient.conversations.create({
      data: {
        bookingId,
        customerId: booking.customerId,
        driverId: booking.driverId,
        status: ConversationStatus.OPEN,
      },
    });

    return conversation;
  }

  public static async sendMessage(
    conversationId: string,
    senderId: string,
    senderType: SenderType,
    content: string,
    messageType: MessageType = MessageType.TEXT
  ) {
    const conversation = await prismaClient.conversations.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation with ID ${conversationId} not found`);
    }

    if (conversation.status === ConversationStatus.CLOSED) {
      throw new BadRequestException("Conversation is closed");
    }

    if (senderType === SenderType.CUSTOMER && conversation.customerId !== senderId) {
      throw new ForbiddenException("You are not part of this conversation");
    }

    const driver = await prismaClient.drivers.findUnique({
      where: { userId: senderId },
    });

    if (senderType === SenderType.DRIVER && conversation.driverId !== driver?.id) {
      throw new ForbiddenException("You are not part of this conversation");
    }

    const message = await prismaClient.messages.create({
      data: {
        conversationId,
        senderId,
        senderType,
        content,
        messageType,
      },
    });

    return message;
  }

  public static async getConversationMessages(conversationId: string, userId: string) {
    const conversation = await prismaClient.conversations.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation with ID ${conversationId} not found`);
    }

    // conversation.driverId is a Drivers.id, not a user id, so the driver has
    // to be resolved first. Comparing it to the user id locked every driver
    // out of their own conversations.
    if (conversation.customerId !== userId) {
      const driver = await prismaClient.drivers.findUnique({ where: { userId }, select: { id: true } });
      if (!driver || conversation.driverId !== driver.id) {
        throw new ForbiddenException("You are not part of this conversation");
      }
    }

    const messages = await prismaClient.messages.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: {
        sender: { select: { id: true, name: true, pic: true } },
      },
    });

    return messages;
  }

  public static async markMessagesAsRead(conversationId: string, userId: string) {
    await prismaClient.messages.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });

    return { message: "Messages marked as read" };
  }

  public static async closeConversation(conversationId: string) {
    const conversation = await prismaClient.conversations.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation with ID ${conversationId} not found`);
    }

    return await prismaClient.conversations.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.CLOSED },
    });
  }

  public static async getBookingConversation(bookingId: string) {
    const conversation = await prismaClient.conversations.findUnique({
      where: { bookingId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            sender: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!conversation) {
      return null;
    }

    const unreadCount = await prismaClient.messages.count({
      where: {
        conversationId: conversation.id,
        isRead: false,
      },
    });

    return { ...conversation, unreadCount };
  }
}

export default ChatService;
