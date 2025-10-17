import { Elysia } from 'elysia';
import { logger } from '../utils/logger.js';
import { WebhookService } from '../services/webhookService.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { WhatsAppWebhookPayload } from '../types/index.js';
import { WhatsAppAgent } from '../agents/whatsappAgent.js';
import { AudioService } from '../services/audioService.js';

/**
 * Rutas relacionadas con el webhook de WhatsApp
 * Maneja la verificación y recepción de mensajes desde WhatsApp
 */

const webhookService = new WebhookService();
let whatsappService: WhatsAppService;
let whatsappAgent: WhatsAppAgent;

// Función para procesar mensajes entrantes (se importa desde index.ts)
let processIncomingMessage: (message: any) => Promise<void>;

export function setProcessIncomingMessageHandler(handler: (message: any) => Promise<void>) {
  logger.info('🔧 setProcessIncomingMessageHandler llamado en webhookRoutes', { hasHandler: !!handler });
  if (!handler) {
    logger.error('❌ CRÍTICO: Intentando asignar processIncomingMessage undefined');
    throw new Error('processIncomingMessage no puede ser undefined');
  }
  processIncomingMessage = handler;
  logger.info('✅ processIncomingMessage asignado en webhookRoutes', { hasProcessIncomingMessage: !!processIncomingMessage });
}

export function setWhatsAppService(service: WhatsAppService) {
  logger.info('🔧 setWhatsAppService llamado en webhookRoutes', { hasService: !!service });
  if (!service) {
    logger.error('❌ CRÍTICO: Intentando asignar WhatsAppService undefined');
    throw new Error('WhatsAppService no puede ser undefined');
  }
  whatsappService = service;
  logger.info('✅ WhatsAppService asignado en webhookRoutes', { hasWhatsAppService: !!whatsappService });
}

export function setWhatsAppAgent(agent: WhatsAppAgent) {
  logger.info('🔧 setWhatsAppAgent llamado en webhookRoutes', { hasAgent: !!agent });
  if (!agent) {
    logger.error('❌ CRÍTICO: Intentando asignar WhatsAppAgent undefined');
    throw new Error('WhatsAppAgent no puede ser undefined');
  }
  whatsappAgent = agent;
  logger.info('✅ WhatsAppAgent asignado en webhookRoutes', { hasWhatsAppAgent: !!whatsappAgent });
}

export const webhookRoutes = new Elysia({ prefix: '/webhook' })
  // Ruta GET /webhook - Verificación de webhook de WhatsApp
  .get('/', (ctx) => {
    try {
      const query = ctx.query as Record<string, string>;
      const mode = query['hub.mode'];
      const token = query['hub.verify_token'];
      const challenge = query['hub.challenge'];

      logger.info('Solicitud de verificación de webhook recibida', { mode });

      const result = webhookService.verifyWebhook(mode || '', token || '', challenge || '');

      if (result === null) {
        logger.warn('Verificación de webhook fallida');
        ctx.set.status = 403;
        return { error: 'Verificación fallida' };
      }

      logger.info('✅ Verificación de webhook exitosa');
      ctx.set.status = 200;
      return result;

    } catch (error) {
      logger.error('Error en verificación de webhook', {
        error: error instanceof Error ? error.message : String(error)
      });
      ctx.set.status = 500;
      return { error: 'Error interno' };
    }
  })

  // Ruta POST /webhook - Recepción de mensajes de WhatsApp
  .post('/', async (ctx) => {
    try {
      const payload = ctx.body as WhatsAppWebhookPayload;

      logger.info('Webhook POST recibido', {
        object: payload.object,
        entryCount: payload.entry?.length || 0,
        timestamp: new Date().toISOString()
      });

      // Procesar payload del webhook
      logger.info('Iniciando procesamiento del payload del webhook', {
        object: payload.object,
        entryCount: payload.entry?.length || 0
      });
      const processingResult = webhookService.processWebhookPayload(payload);
      logger.info('Payload del webhook validado exitosamente', {
        hasMessage: !!processingResult.message,
        shouldRespond: processingResult.shouldRespond,
        messageType: processingResult.message?.type,
        messageId: processingResult.message?.id
      });

      if (!processingResult.success) {
        logger.warn('Error procesando payload del webhook', {
          error: processingResult.error,
          payloadObject: payload.object,
          entryCount: payload.entry?.length || 0
        });
        ctx.set.status = 400;
        return { error: processingResult.error };
      }

      logger.debug('Payload del webhook procesado exitosamente', {
        hasMessage: !!processingResult.message,
        shouldRespond: processingResult.shouldRespond,
        messageType: processingResult.message?.type,
        messageId: processingResult.message?.id
      });

      // Si hay mensaje para procesar, hacerlo de forma asíncrona
      if (processingResult.message && processingResult.shouldRespond) {
        logger.info('Iniciando procesamiento asíncrono de mensaje', {
          messageId: processingResult.message.id,
          messageType: processingResult.message.type,
          from: processingResult.message.from
        });

        // Marcar mensaje como leído antes de procesar
        logger.info('Marcando mensaje como leído', { messageId: processingResult.message.id });
        try {
          await whatsappService.markMessageAsRead(processingResult.message.id);
          logger.info('Mensaje marcado como leído exitosamente', { messageId: processingResult.message.id });
        } catch (error) {
          logger.warn('Error marcando mensaje como leído, continuando con procesamiento', {
            messageId: processingResult.message.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        // Procesar mensaje directamente con el agente WhatsApp
        const message = processingResult.message!;
        logger.info('Iniciando procesamiento de mensaje en background', {
          messageId: message.id,
          messageType: message.type
        });
        setImmediate(async () => {
          try {
            logger.debug('Ejecutando procesamiento de mensaje en background', {
              messageId: message.id,
              hasWhatsAppAgent: !!whatsappAgent
            });
            if (!whatsappAgent) {
              logger.error('❌ CRÍTICO: whatsappAgent es undefined - usando processIncomingMessage como fallback', {
                messageId: message.id,
                timestamp: new Date().toISOString()
              });
              // Fallback: usar la función processIncomingMessage original
              await processIncomingMessage(message);
              return;
            }

            let response: string | undefined;

            // Procesar mensaje de texto directamente
            if (message.type === 'text') {
              const textContent = (message as any).text?.body || '';
              response = await whatsappAgent.processTextMessage(
                message.from,
                textContent,
                message.id
              );
            } else if (message.type === 'audio') {
              const audioId = (message as any).audio?.id;
              if (audioId) {
                const audioService = new AudioService();
                const transcriptionResult = await audioService.processWhatsAppAudio(audioId);
                if (transcriptionResult.success && transcriptionResult.text) {
                  response = await whatsappAgent.processVoiceMessage(
                    message.from,
                    transcriptionResult.text,
                    message.id
                  );
                } else {
                  response = 'Lo siento, no pude transcribir el audio.';
                }
              } else {
                response = 'No se pudo obtener el ID del audio.';
              }
            } else {
              logger.warn('Tipo de mensaje no soportado directamente por el agente', {
                messageId: message.id,
                type: message.type
              });
            }

            if (response) {
              await whatsappService.sendTextMessage(message.from, response);
            }

          } catch (error) {
            logger.error('Error en procesamiento de mensaje en background', {
              messageId: message.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });
        logger.info('Procesamiento de mensaje finalizado exitosamente', {
          messageId: processingResult.message.id,
          messageType: processingResult.message.type
        });
      } else {
        logger.debug('No se requiere procesamiento de mensaje', {
          hasMessage: !!processingResult.message,
          shouldRespond: processingResult.shouldRespond
        });
      }

      // Responder inmediatamente a WhatsApp (requerido para no perder el webhook)
      logger.debug('Enviando respuesta OK al webhook de WhatsApp');
      ctx.set.status = 200;
      return { status: 'ok' };

    } catch (error) {
      logger.error('Error en recepción de webhook', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        payload: ctx.body ? 'presente' : 'ausente'
      });
      ctx.set.status = 500;
      return { error: 'Error interno del servidor' };
    }
  });