import { z } from "zod";
import { CHAT_LIMITS } from "./limits";

export const gymIdParamSchema = z.object({
  gymId: z.string().trim().min(1).max(CHAT_LIMITS.gymIdMax),
});

export const conversationIdParamSchema = z.object({
  conversationId: z.string().uuid(),
});

export const messagesQuerySchema = z.object({
  before: z.string().trim().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_LIMITS.messagePageMax)
    .optional()
    .default(CHAT_LIMITS.messagePageMax),
});

export const sendMessageBodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(CHAT_LIMITS.messageBodyMin)
    .max(CHAT_LIMITS.messageBodyMax),
});

export const createDmBodySchema = z.object({
  peerUserId: z.string().uuid(),
});

export const pixelSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
});

export type GymIdParam = z.infer<typeof gymIdParamSchema>;
export type ConversationIdParam = z.infer<typeof conversationIdParamSchema>;
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;
export type CreateDmBody = z.infer<typeof createDmBodySchema>;

export type GymListItem = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  imageKey: string | null;
  conversationId: string;
  memberCount: number;
  joined: boolean;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderDisplayName: string;
  body: string;
  createdAt: string;
};

export type GymChatListItem = {
  gymId: string;
  name: string;
  imageKey: string | null;
  conversationId: string;
  memberCount: number;
};

export type DmListItem = {
  conversationId: string;
  peerUserId: string;
  peerDisplayName: string;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
};

export type PixelSearchItem = {
  userId: string;
  displayName: string;
};
