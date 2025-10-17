// Tipos base para el proyecto Bun Elysya - Agente conversacional con WhatsApp

/**
 * Tipo base para mensajes de WhatsApp
 */
export interface WhatsAppMessage {
  id: string;
  from: string; // Número de teléfono del remitente
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contact';
}

/**
 * Mensaje de texto de WhatsApp
 */
export interface WhatsAppTextMessage extends WhatsAppMessage {
  type: 'text';
  text: {
    body: string;
  };
}

/**
 * Mensaje de media (imagen, video, audio, documento)
 */
export interface WhatsAppMediaMessage extends WhatsAppMessage {
  type: 'image' | 'video' | 'audio' | 'document';
  [key: string]: any; // Para campos específicos de cada tipo de media
}

/**
 * Payload de webhook entrante de WhatsApp
 */
export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages?: WhatsAppMessage[];
        statuses?: any[];
      };
      field: 'messages';
    }>;
  }>;
}

/**
 * Respuesta de la API de WhatsApp para enviar mensajes
 */
export interface WhatsAppSendResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

/**
 * Tipos para LangGraph - Estado del agente conversacional
 */
export interface AgentState {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
  }>;
  session_id: string;
  context: Record<string, any>; // Contexto adicional del agente
  current_node?: string; // Nodo actual en el grafo
}

/**
 * Mensaje para LangGraph
 */
export interface LangGraphMessage {
  role: 'human' | 'ai' | 'system';
  content: string;
  additional_kwargs?: Record<string, any>;
}

/**
 * Tipos para base de datos - Tablas principales
 */

/**
 * Usuario/Sesión de WhatsApp
 */
export interface DatabaseUser {
  id: string;
  wa_id: string; // WhatsApp ID
  phone_number: string;
  profile_name?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Mensaje almacenado en base de datos
 */
export interface DatabaseMessage {
  id: string;
  user_id: string;
  direction: 'incoming' | 'outgoing';
  message_type: WhatsAppMessage['type'];
  content: string; // JSON stringified para media, texto plano para text
  whatsapp_message_id: string;
  timestamp: Date;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
}

/**
 * Sesión de conversación
 */
export interface DatabaseSession {
  id: string;
  user_id: string;
  agent_state: string; // JSON stringified AgentState
  created_at: Date;
  updated_at: Date;
  expires_at?: Date;
}

/**
 * Archivo media descargado
 */
export interface MediaFile {
  id: string;
  whatsapp_media_id: string;
  mime_type: string;
  file_size: number;
  file_path: string; // Ruta local donde se guardó
  url: string; // URL temporal de WhatsApp
  downloaded_at: Date;
}

/**
 * Configuración de media para descarga
 */
export interface MediaDownloadOptions {
  timeout?: number; // Timeout en ms, default 30000
  maxSize?: number; // Tamaño máximo en bytes
  allowedTypes?: string[]; // Tipos MIME permitidos
}

/**
 * Resultado de descarga de media
 */
export interface MediaDownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
  metadata?: {
    mimeType: string;
    size: number;
  };
}

/**
 * Tipos de error personalizados
 */
export class WhatsAppError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class MediaDownloadError extends Error {
  constructor(message: string, public mediaId?: string) {
    super(message);
    this.name = 'MediaDownloadError';
  }
}