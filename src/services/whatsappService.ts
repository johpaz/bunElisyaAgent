import { config } from '../utils/config.js';
import { logger, logWhatsApp } from '../utils/logger.js';
import {
  WhatsAppSendResponse,
  WhatsAppError,
  WhatsAppMessage
} from '../types/index.js';

/**
 * Servicio para interactuar con WhatsApp Business API
 * Maneja envío de mensajes, plantillas y comunicación con Meta API
 */
export class WhatsAppService {
  private readonly baseUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor() {
    this.baseUrl = config.metaBaseUrl;
    this.phoneNumberId = config.whatsappPhoneNumberId;
    this.accessToken = config.metaToken;
  }

  /**
   * Envía un mensaje de texto a un número de WhatsApp
   * @param to Número de teléfono del destinatario (con código de país, sin +)
   * @param message Texto del mensaje a enviar
   * @returns Respuesta de la API de WhatsApp
   */
  async sendTextMessage(to: string, message: string): Promise<WhatsAppSendResponse> {
    try {
      logWhatsApp('send_text_message', to);

      const payload = {
        messaging_product: 'whatsapp' as const,
        recipient_type: 'individual' as const,
        to,
        type: 'text' as const,
        text: {
          body: message
        }
      };

      const response = await this.makeAPIRequest('messages', payload);

      logger.info({
        to,
        messageId: response.messages?.[0]?.id,
        status: 'sent'
      }, 'Mensaje de texto enviado exitosamente');

      return response;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        to,
        message: message.substring(0, 100) + (message.length > 100 ? '...' : '')
      }, 'Error enviando mensaje de texto');

      throw error;
    }
  }

  /**
   * Envía una plantilla de mensaje de WhatsApp
   * @param to Número de teléfono del destinatario
   * @param templateName Nombre de la plantilla configurada
   * @param language Código de idioma (ej: 'es', 'en')
   * @param components Componentes de la plantilla (opcional)
   * @returns Respuesta de la API de WhatsApp
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    language: string = 'es',
    components?: any[]
  ): Promise<WhatsAppSendResponse> {
    try {
      logWhatsApp('send_template_message', to);

      const payload = {
        messaging_product: 'whatsapp' as const,
        recipient_type: 'individual' as const,
        to,
        type: 'template' as const,
        template: {
          name: templateName,
          language: {
            code: language
          },
          ...(components && { components })
        }
      };

      const response = await this.makeAPIRequest('messages', payload);

      logger.info({
        to,
        templateName,
        language,
        messageId: response.messages?.[0]?.id,
        status: 'sent'
      }, 'Plantilla de mensaje enviada exitosamente');

      return response;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        to,
        templateName,
        language
      }, 'Error enviando plantilla de mensaje');

      throw error;
    }
  }

  /**
   * Envía un mensaje de media (imagen, video, documento)
   * @param to Número de teléfono del destinatario
   * @param mediaId ID del media subido previamente
   * @param type Tipo de media ('image', 'video', 'document')
   * @param caption Texto opcional para acompañar el media
   * @returns Respuesta de la API de WhatsApp
   */
  async sendMediaMessage(
    to: string,
    mediaId: string,
    type: 'image' | 'video' | 'document',
    caption?: string
  ): Promise<WhatsAppSendResponse> {
    try {
      logWhatsApp('send_media_message', to);

      const payload = {
        messaging_product: 'whatsapp' as const,
        recipient_type: 'individual' as const,
        to,
        type,
        [type]: {
          id: mediaId,
          ...(caption && { caption })
        }
      };

      const response = await this.makeAPIRequest('messages', payload);

      logger.info({
        to,
        mediaId,
        type,
        messageId: response.messages?.[0]?.id,
        status: 'sent'
      }, 'Mensaje de media enviado exitosamente');

      return response;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        to,
        mediaId,
        type
      }, 'Error enviando mensaje de media');

      throw error;
    }
  }

  /**
   * Sube un archivo media a WhatsApp para obtener un media ID
   * @param filePath Ruta del archivo a subir
   * @param type Tipo MIME del archivo
   * @returns ID del media subido
   */
  async uploadMedia(filePath: string, type: string): Promise<string> {
    try {
      logger.info({ filePath, type }, 'Iniciando subida de media a WhatsApp');

      // Leer archivo como buffer usando fs nativo
      const { readFile } = await import('fs/promises');
      const fileBuffer = await readFile(filePath);

      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type }), 'media');
      formData.append('messaging_product', 'whatsapp');

      const url = `${this.baseUrl}/${this.phoneNumberId}/media`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new WhatsAppError(
          `Error subiendo media: ${response.status} ${response.statusText} - ${errorData}`
        );
      }

      const data = await response.json();

      if (!data.id) {
        throw new WhatsAppError('ID de media no encontrado en respuesta');
      }

      logger.info({
        filePath,
        type,
        mediaId: data.id
      }, 'Media subido exitosamente a WhatsApp');

      return data.id;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        filePath,
        type
      }, 'Error subiendo media a WhatsApp');

      throw error;
    }
  }

  /**
   * Método privado para hacer requests a la API de WhatsApp
   * Incluye autenticación, manejo de errores y logging
   */
  private async makeAPIRequest(endpoint: string, payload: any): Promise<WhatsAppSendResponse> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/${endpoint}`;

    logger.debug({
      url,
      payload: JSON.stringify(payload).substring(0, 200) + '...'
    }, 'Realizando request a WhatsApp API');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new WhatsAppError(
          `WhatsApp API Error: ${response.status} ${response.statusText} - ${responseText}`
        );
      }

      let data: WhatsAppSendResponse;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        throw new WhatsAppError(`Error parseando respuesta JSON: ${responseText}`);
      }

      // Validar estructura de respuesta
      if (!data.messaging_product || !data.contacts || !data.messages) {
        throw new WhatsAppError(`Respuesta inválida de WhatsApp API: ${responseText}`);
      }

      logger.debug({
        messagingProduct: data.messaging_product,
        contactsCount: data.contacts.length,
        messagesCount: data.messages.length
      }, 'Respuesta exitosa de WhatsApp API');

      return data;

    } catch (error) {
      // Re-throw WhatsAppError instances
      if (error instanceof WhatsAppError) {
        throw error;
      }

      // Wrap otros errores
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new WhatsAppError('Request timeout a WhatsApp API');
        }
        if (error.message.includes('fetch')) {
          throw new WhatsAppError(`Error de conexión: ${error.message}`);
        }
      }

      throw new WhatsAppError(
        `Error desconocido en request a WhatsApp API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
    * Marca un mensaje como leído en WhatsApp
    * @param messageId ID del mensaje a marcar como leído
    */
  async markMessageAsRead(messageId: string): Promise<void> {
    try {
      logger.info({ messageId }, 'Marcando mensaje como leído en WhatsApp');

      const payload = {
        messaging_product: 'whatsapp' as const,
        status: 'read' as const,
        message_id: messageId
      };

      const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new WhatsAppError(
          `Error marcando mensaje como leído: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      if (!data.success || data.success !== true) {
        throw new WhatsAppError(`Respuesta inválida de WhatsApp API para mark-as-read: ${JSON.stringify(data)}`);
      }

      logger.info({ messageId }, 'Mensaje marcado como leído exitosamente');

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId
      }, 'Error marcando mensaje como leído');

      throw error;
    }
  }

  /**
   * Verifica el estado de conectividad con WhatsApp API
   * @returns true si la conexión es exitosa
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Intentar obtener información del número de teléfono
      const url = `${this.baseUrl}/${this.phoneNumberId}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn({
          status: response.status,
          statusText: response.statusText
        }, 'Health check fallido - WhatsApp API no responde correctamente');
        return false;
      }

      const data = await response.json();

      if (!data.id || !data.display_phone_number) {
        logger.warn({ data }, 'Health check fallido - Respuesta inválida');
        return false;
      }

      logger.debug('Health check exitoso - WhatsApp API operativo');
      return true;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Error en health check de WhatsApp API');
      return false;
    }
  }
}