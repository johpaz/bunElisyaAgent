import { BaseMessage, MessageType, MessageProcessingResult } from '../types/messageProcessing.js';
import { WhatsAppAgent } from '../agents/whatsappAgent.js';
import { WhatsAppService } from './whatsappService.js';
import { logger } from '../utils/logger.js';

/**
 * Router para procesar mensajes de diferentes tipos
 * Delega el procesamiento al agente WhatsApp apropiado según el tipo de mensaje
 */
export class MessageRouter {
  private whatsappAgent: WhatsAppAgent;
  private whatsappService: WhatsAppService;

  constructor(whatsappAgent: WhatsAppAgent, whatsappService: WhatsAppService) {
    this.whatsappAgent = whatsappAgent;
    this.whatsappService = whatsappService;
    logger.info('MessageRouter inicializado correctamente');
  }

  /**
   * Procesa un mensaje delegando al agente apropiado según el tipo
   * @param message El mensaje base a procesar
   * @returns Resultado del procesamiento
   */
  async processMessage(message: BaseMessage): Promise<MessageProcessingResult> {
    const startTime = Date.now();

    try {
      logger.info('Iniciando procesamiento de mensaje vía router', {
        messageId: message.id,
        messageType: message.type,
        from: message.from,
        timestamp: new Date().toISOString()
      });

      let response: string;
      const waId = message.from;

      // Procesar según el tipo de mensaje
      switch (message.type) {
        case MessageType.TEXT:
          logger.debug('Procesando mensaje de texto vía router', { messageId: message.id, waId });

          // Extraer el contenido del mensaje de texto
          const textContent = message.content?.text?.body || message.content?.body || '';
          if (!textContent.trim()) {
            throw new Error('Contenido de mensaje de texto vacío');
          }

          logger.debug('Contenido del mensaje de texto extraído', {
            messageId: message.id,
            contentLength: textContent.length,
            contentPreview: textContent.substring(0, 50) + (textContent.length > 50 ? '...' : '')
          });

          // Delegar al agente WhatsApp para procesar el mensaje de texto
          // El agente usa el modelo OpenAI configurado (gpt-5-nano o el especificado en config)
          response = await this.whatsappAgent.processTextMessage(waId, textContent, message.id);

          logger.info('Respuesta generada por el agente para mensaje de texto', {
            messageId: message.id,
            waId,
            responseLength: response.length,
            responsePreview: response.substring(0, 50) + (response.length > 50 ? '...' : '')
          });

          break;

        case MessageType.AUDIO:
          logger.debug('Procesando mensaje de audio vía router', { messageId: message.id, waId });

          // Para audio, asumimos que ya está transcrito en el content
          const transcription = message.content?.transcription || message.content?.text || '';
          if (!transcription.trim()) {
            throw new Error('Transcripción de audio no disponible');
          }

          // Delegar al agente para procesar la transcripción
          response = await this.whatsappAgent.processVoiceMessage(waId, transcription, message.id);

          logger.info('Respuesta generada por el agente para mensaje de audio', {
            messageId: message.id,
            waId,
            transcriptionLength: transcription.length,
            responseLength: response.length
          });

          break;

        default:
          logger.info('Procesando mensaje de tipo no soportado vía router', {
            messageId: message.id,
            waId,
            type: message.type
          });

          // Para tipos no soportados, enviar respuesta genérica
          response = `Recibí tu mensaje de tipo ${message.type}. Por ahora solo proceso mensajes de texto y voz.`;
          break;
      }

      // Enviar la respuesta vía WhatsApp
      logger.debug('Enviando respuesta vía WhatsApp Service', { messageId: message.id, waId });
      await this.whatsappService.sendTextMessage(waId, response);

      const duration = Date.now() - startTime;
      logger.info('✅ Mensaje procesado y respondido exitosamente vía router', {
        messageId: message.id,
        waId,
        messageType: message.type,
        responseLength: response.length,
        duration: `${duration}ms`
      });

      return {
        success: true,
        response,
        metadata: {
          processingTime: duration,
          messageType: message.type,
          waId
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('❌ Error procesando mensaje vía router', {
        messageId: message.id,
        waId: message.from,
        messageType: message.type,
        duration: `${duration}ms`,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });

      // Intentar enviar mensaje de error al usuario
      try {
        const waId = message.from;
        logger.debug('Intentando enviar mensaje de error al usuario vía router', { waId, messageId: message.id });
        await this.whatsappService.sendTextMessage(
          waId,
          `Lo siento, ocurrió un error procesando tu mensaje: ${errorMessage}`
        );
        logger.debug('Mensaje de error enviado exitosamente vía router', { waId, messageId: message.id });
      } catch (sendError) {
        logger.error('❌ Error enviando mensaje de error al usuario vía router', {
          waId: message.from,
          messageId: message.id,
          error: sendError instanceof Error ? sendError.message : String(sendError),
          stack: sendError instanceof Error ? sendError.stack : undefined
        });
      }

      return {
        success: false,
        error: errorMessage,
        metadata: {
          processingTime: duration,
          messageType: message.type,
          waId: message.from
        }
      };
    }
  }
}