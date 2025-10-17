import crypto from 'crypto';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppTextMessage,
  WhatsAppMediaMessage,
  ValidationError,
  WhatsAppError
} from '../types/index.js';

/**
 * Tipos de eventos que maneja el webhook
 */
export type WebhookEventType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contact';

/**
 * Interfaz para el resultado del procesamiento de webhook
 */
export interface WebhookProcessingResult {
  success: boolean;
  eventType?: WebhookEventType;
  message?: WhatsAppMessage;
  error?: string;
  shouldRespond?: boolean;
}

/**
 * Servicio para manejar webhooks de WhatsApp Business API
 * Incluye verificación de webhook, validación de payloads y routing inteligente
 */
export class WebhookService {
  private readonly verifyToken: string;

  constructor() {
    this.verifyToken = config.metaVerifyToken;
  }

  /**
   * Verifica la solicitud de verificación de webhook de Meta/Facebook
   * Esta verificación es requerida para configurar el webhook inicialmente
   * @param mode Modo de verificación (debe ser 'subscribe')
   * @param token Token de verificación
   * @param challenge Challenge que debe ser devuelto
   * @returns Challenge si la verificación es exitosa, null si falla
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    try {
      logger.info({ mode, token: token.substring(0, 10) + '...' }, 'Verificando webhook de WhatsApp');

      // Validar modo
      if (mode !== 'subscribe') {
        logger.warn({ mode }, 'Modo de verificación inválido');
        return null;
      }

      // Validar token
      if (token !== this.verifyToken) {
        logger.warn('Token de verificación incorrecto');
        return null;
      }

      // Validar challenge
      if (!challenge || challenge.length === 0) {
        logger.warn('Challenge vacío o inválido');
        return null;
      }

      logger.info('Verificación de webhook exitosa');
      return challenge;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        mode,
        challenge: challenge.substring(0, 20) + '...'
      }, 'Error durante verificación de webhook');
      return null;
    }
  }

  /**
   * Procesa un payload de webhook entrante de WhatsApp
   * Valida la estructura, extrae mensajes y determina el tipo de evento
   * @param payload Payload crudo del webhook
   * @returns Resultado del procesamiento
   */
  processWebhookPayload(payload: any): WebhookProcessingResult {
    try {
      logger.debug({ payload }, 'Procesando payload de webhook');

      // Validar estructura básica del payload
      const validationResult = this.validateWebhookPayload(payload);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: validationResult.error
        };
      }

      const typedPayload = payload as WhatsAppWebhookPayload;

      // Procesar cada entrada del webhook
      for (const entry of typedPayload.entry) {
        const result = this.processWebhookEntry(entry);
        if (result) {
          return result;
        }
      }

      // Si no se encontraron mensajes procesables
      logger.debug('No se encontraron mensajes procesables en el webhook');
      return {
        success: true,
        shouldRespond: false
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        payload: JSON.stringify(payload).substring(0, 500) + '...'
      }, 'Error procesando payload de webhook');

      return {
        success: false,
        error: `Error procesando webhook: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Valida la estructura básica del payload de webhook
   */
  private validateWebhookPayload(payload: any): { isValid: boolean; error?: string } {
    try {
      // Verificar campos requeridos
      if (!payload || typeof payload !== 'object') {
        return { isValid: false, error: 'Payload inválido o vacío' };
      }

      if (payload.object !== 'whatsapp_business_account') {
        return { isValid: false, error: 'Object debe ser whatsapp_business_account' };
      }

      if (!Array.isArray(payload.entry) || payload.entry.length === 0) {
        return { isValid: false, error: 'Entry debe ser un array no vacío' };
      }

      // Validar cada entrada
      for (const entry of payload.entry) {
        if (!entry.id || !entry.changes || !Array.isArray(entry.changes)) {
          return { isValid: false, error: 'Entrada inválida: faltan campos requeridos' };
        }

        for (const change of entry.changes) {
          if (change.field !== 'messages') {
            continue; // Solo procesamos cambios de mensajes
          }

          if (!change.value || !change.value.messaging_product ||
              change.value.messaging_product !== 'whatsapp') {
            return { isValid: false, error: 'Valor de cambio inválido' };
          }
        }
      }

      return { isValid: true };

    } catch (error) {
      return {
        isValid: false,
        error: `Error de validación: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Procesa una entrada individual del webhook
   */
  private processWebhookEntry(entry: WhatsAppWebhookPayload['entry'][0]): WebhookProcessingResult | null {
    try {
      for (const change of entry.changes) {
        if (change.field !== 'messages') {
          continue; // Solo procesamos mensajes
        }

        const { messages, statuses } = change.value;

        // Procesar mensajes entrantes
        if (messages && messages.length > 0) {
          for (const message of messages) {
            const result = this.processIncomingMessage(message);
            if (result) {
              return result;
            }
          }
        }

        // Procesar actualizaciones de estado (opcional)
        if (statuses && statuses.length > 0) {
          logger.debug({ statusCount: statuses.length }, 'Statuses de mensaje recibidos (no procesados)');
        }
      }

      return null;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        entryId: entry.id
      }, 'Error procesando entrada de webhook');
      return null;
    }
  }

  /**
   * Procesa un mensaje entrante individual
   */
  private processIncomingMessage(message: WhatsAppMessage): WebhookProcessingResult | null {
    try {
      logger.info({
        messageId: message.id,
        from: message.from,
        type: message.type,
        timestamp: message.timestamp
      }, 'Procesando mensaje entrante');

      // Determinar tipo de evento basado en el tipo de mensaje
      const eventType = this.determineEventType(message);

      // Validar que sea un mensaje procesable
      if (!this.isProcessableMessage(message)) {
        logger.debug({ messageId: message.id, type: message.type }, 'Mensaje no procesable, ignorando');
        return null;
      }

      // Para mensajes de texto, verificar que no esté vacío
      if (message.type === 'text') {
        const textMessage = message as WhatsAppTextMessage;
        if (!textMessage.text?.body?.trim()) {
          logger.debug({ messageId: message.id }, 'Mensaje de texto vacío, ignorando');
          return null;
        }
      }

      return {
        success: true,
        eventType,
        message,
        shouldRespond: this.shouldAutoRespond(message)
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: message.id,
        type: message.type
      }, 'Error procesando mensaje entrante');

      return null;
    }
  }

  /**
   * Determina el tipo de evento basado en el mensaje
   */
  private determineEventType(message: WhatsAppMessage): WebhookEventType {
    switch (message.type) {
      case 'text':
        return 'text';
      case 'image':
        return 'image';
      case 'video':
        return 'video';
      case 'audio':
        return 'audio';
      case 'document':
        return 'document';
      case 'location':
        return 'location';
      case 'contact':
        return 'contact';
      default:
        logger.warn({ type: message.type, messageId: message.id }, 'Tipo de mensaje desconocido');
        return 'text'; // Default fallback
    }
  }

  /**
   * Determina si un mensaje debe ser procesado
   */
  private isProcessableMessage(message: WhatsAppMessage): boolean {
    // Solo procesar mensajes de usuarios (no de sistema)
    if (!message.from) {
      return false;
    }

    // Procesar todos los tipos soportados
    const supportedTypes: WhatsAppMessage['type'][] = [
      'text', 'image', 'video', 'audio', 'document', 'location', 'contact'
    ];

    return supportedTypes.includes(message.type);
  }

  /**
   * Determina si se debe responder automáticamente a un mensaje
   */
  private shouldAutoRespond(message: WhatsAppMessage): boolean {
    // Responder automáticamente a mensajes de texto
    if (message.type === 'text') {
      return true;
    }

    // Responder automáticamente a mensajes de audio (para transcripción)
    if (message.type === 'audio') {
      return true;
    }

    // Para otros tipos, depender del contexto del agente
    return false;
  }

  /**
   * Verifica la firma del webhook para seguridad adicional
   * (Opcional pero recomendado para producción)
   * @param signature Firma del header X-Hub-Signature-256
   * @param body Raw body del request
   * @returns true si la firma es válida
   */
  verifyWebhookSignature(signature: string | undefined, body: string): boolean {
    try {
      if (!signature) {
        logger.warn('Firma de webhook faltante');
        return false;
      }

      // Extraer la firma del header (formato: sha256=...)
      const expectedSignature = signature.replace('sha256=', '');

      // Crear firma esperada usando el app secret
      const appSecret = config.metaToken; // En producción usar un app secret dedicado
      const expectedHash = crypto
        .createHmac('sha256', appSecret)
        .update(body, 'utf8')
        .digest('hex');

      // Comparar firmas de forma segura (tiempo constante)
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(expectedHash, 'hex')
      );

      if (!isValid) {
        logger.warn('Firma de webhook inválida');
      }

      return isValid;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Error verificando firma de webhook');
      return false;
    }
  }

  /**
   * Método helper para extraer información útil del mensaje para logging
   */
  extractMessageInfo(message: WhatsAppMessage): Record<string, any> {
    const info: Record<string, any> = {
      id: message.id,
      from: message.from,
      type: message.type,
      timestamp: message.timestamp
    };

    if (message.type === 'text') {
      const textMsg = message as WhatsAppTextMessage;
      info.textLength = textMsg.text?.body?.length || 0;
      info.preview = textMsg.text?.body?.substring(0, 50) + (textMsg.text?.body?.length > 50 ? '...' : '');
    } else if (['image', 'video', 'audio', 'document'].includes(message.type)) {
      const mediaMsg = message as WhatsAppMediaMessage;
      // Aquí se pueden agregar campos específicos de media si están disponibles
      info.hasMedia = true;
    }

    return info;
  }
}