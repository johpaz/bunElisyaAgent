/**
 * Tipos e interfaces base para el procesamiento modular de mensajes
 * Soporta diferentes tipos de mensajes con procesadores especializados
 */

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  DOCUMENT = 'document',
  LOCATION = 'location',
  CONTACT = 'contact',
  STICKER = 'sticker',
  UNKNOWN = 'unknown'
}

export interface BaseMessage {
  id: string;
  type: MessageType;
  from: string;
  timestamp: number;
  content?: any;
  metadata?: Record<string, any>;
}

export interface MessageProcessingResult {
  success: boolean;
  error?: string;
  response?: any;
  metadata?: Record<string, any>;
}

export interface MessageProcessor {
  canProcess(message: BaseMessage): boolean;
  process(message: BaseMessage): Promise<MessageProcessingResult>;
}

export interface MessageProcessingConfig {
  enabledTypes: MessageType[];
  defaultProcessor?: string;
  timeout?: number;
  retryAttempts?: number;
}