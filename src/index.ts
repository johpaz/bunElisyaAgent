import { Elysia } from 'elysia';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { testConnection } from './database/client.js';
import { createSchema } from './database/schema.js';
import { WebhookService } from './services/webhookService.js';
import { AudioService } from './services/audioService.js';
import { WhatsAppService } from './services/whatsappService.js';
import { WhatsAppAgent } from './agents/whatsappAgent.js';
import { AgentMemory, setDatabaseAvailability } from './agents/memory.js';
import { getOpenAIService } from './services/openaiService.js';
import { healthRoutes, setHealthCheckDependencies } from './routes/healthRoutes.js';
import { webhookRoutes, setProcessIncomingMessageHandler, setWhatsAppService, setWhatsAppAgent } from './routes/webhookRoutes.js';
import { getConfigForEnvironment } from './services/messageProcessingConfig.js';

// Flag global para indicar si la base de datos está disponible
let isDatabaseAvailable = false;
import {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppTextMessage,
  WhatsAppMediaMessage,
  ValidationError,
  WhatsAppError
} from './types/index.js';

/**
 * Punto de entrada principal del servidor Elysia para el agente conversacional de WhatsApp
 * Integra todos los servicios: WhatsApp, Webhook, Audio, Agente y Base de datos
 */

// Inicializar servicios principales
const webhookService = new WebhookService();
const audioService = new AudioService();
const whatsappService = new WhatsAppService();
const whatsappAgent = new WhatsAppAgent();

// WhatsAppAgent ya está inicializado arriba
logger.info('🔧 WhatsAppAgent creado en index.ts', { hasWhatsAppAgent: !!whatsappAgent });

// Verificar que el WhatsAppAgent se creó correctamente
if (!whatsappAgent) {
  throw new Error('Error crítico: WhatsAppAgent no pudo ser creado');
}



/**
 * Función para inicializar la aplicación
 * Valida configuración y conecta a base de datos
 */
async function initializeApp(): Promise<void> {
  try {
    logger.info('Iniciando servidor Bun Elysya - Agente WhatsApp');
    logger.info('🔥 Hot reload activado - cambios en código se aplicarán automáticamente');

    // La configuración ya está validada automáticamente al importar el módulo
    logger.info('✅ Configuración validada automáticamente al inicio');

    // Configurar dependencias de las rutas ANTES de cualquier inicialización asíncrona
    // para evitar condición de carrera con webhooks entrantes
    logger.info('🔧 Configurando handlers de rutas antes de inicialización asíncrona');
    setProcessIncomingMessageHandler(processIncomingMessage);
    setWhatsAppService(whatsappService);
    logger.info('🔧 Configurando WhatsAppAgent en webhookRoutes', { hasWhatsAppAgent: !!whatsappAgent });
    setWhatsAppAgent(whatsappAgent);
    logger.info('✅ Handlers de rutas configurados exitosamente');

    // Probar conexión a base de datos (opcional)
    logger.info('Verificando conexión a base de datos...');
    isDatabaseAvailable = false;
    try {
      if (config.databaseUrl) {
        isDatabaseAvailable = await testConnection();
        if (isDatabaseAvailable) {
          logger.info('✅ Conexión a base de datos establecida');

          // Crear esquemas de base de datos si no existen
          logger.info('Creando esquemas de base de datos si no existen...');
          await createSchema();
          logger.info('✅ Esquemas de base de datos creados/verificados');

          // Limpiar sesiones expiradas al inicio
          logger.info('Limpiando sesiones expiradas...');
          const cleanedSessions = await AgentMemory.cleanupExpiredSessions();
          if (cleanedSessions > 0) {
            logger.info(`✅ ${cleanedSessions} sesiones expiradas limpiadas`);
          }
        } else {
          logger.warn('⚠️ No se pudo conectar a la base de datos - el servidor funcionará sin persistencia');
        }
      } else {
        logger.info('ℹ️ Base de datos no configurada - el servidor funcionará sin persistencia');
      }
    } catch (error) {
      logger.warn('⚠️ Error al verificar conexión a base de datos - el servidor funcionará sin persistencia', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Establecer el estado de la base de datos en AgentMemory
    setDatabaseAvailability(isDatabaseAvailable);

    // Inicializar servicio OpenAI si está configurado
    if (config.apiKeyOpenAI) {
      try {
        logger.info('Inicializando servicio OpenAI...');
        const openAIService = getOpenAIService();
        const isAvailable = await openAIService.isAvailable();
        if (isAvailable) {
          logger.info('✅ Servicio OpenAI inicializado correctamente');
        } else {
          logger.warn('⚠️ Servicio OpenAI inicializado pero no disponible');
        }
      } catch (error) {
        logger.error('❌ Error inicializando servicio OpenAI', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      logger.info('ℹ️ API Key de OpenAI no configurada - usando respuestas estáticas');
    }

    // Configurar dependencias de las rutas restantes
    setHealthCheckDependencies(isDatabaseAvailable, whatsappService, audioService);

    // Verificar que todas las dependencias críticas estén configuradas
    if (!whatsappAgent) {
      logger.error('❌ CRÍTICO: WhatsAppAgent no está disponible después de la configuración');
      throw new Error('WhatsAppAgent no pudo ser configurado correctamente');
    }
    if (!whatsappService) {
      logger.error('❌ CRÍTICO: WhatsAppService no está disponible después de la configuración');
      throw new Error('WhatsAppService no pudo ser configurado correctamente');
    }
    if (!processIncomingMessage) {
      logger.error('❌ CRÍTICO: processIncomingMessage no está disponible después de la configuración');
      throw new Error('processIncomingMessage no pudo ser configurado correctamente');
    }
    logger.info('✅ Todas las dependencias críticas verificadas correctamente', {
      hasWhatsAppAgent: !!whatsappAgent,
      hasWhatsAppService: !!whatsappService,
      hasProcessIncomingMessage: !!processIncomingMessage
    });
    

    logger.info('🚀 Servidor inicializado correctamente', {
      databaseAvailable: isDatabaseAvailable,
      port: config.port
    });

    // Log adicional para verificar que no hay doble inicialización
    logger.info('🔍 Verificación: Solo una instancia del servidor ejecutándose');
  } catch (error) {
    logger.error('❌ Error durante la inicialización', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}

/**
 * Función para procesar mensajes entrantes de WhatsApp
 * Implementa el flujo completo: recepción → procesamiento → respuesta
 */
async function processIncomingMessage(message: WhatsAppMessage): Promise<void> {
  const startTime = Date.now();
  try {
    logger.info('📨 Iniciando procesamiento de mensaje entrante', {
      messageId: message.id,
      from: message.from,
      type: message.type,
      timestamp: new Date().toISOString()
    });

    const waId = message.from; // WA ID como identificador de usuario
    logger.info('Tipo de mensaje recibido', { type: message.type, messageId: message.id });
    logger.debug('Identificador de usuario extraído', { waId, messageId: message.id });

    // Determinar tipo de mensaje y procesar según corresponda
    if (message.type === 'text') {
      logger.debug('Procesando mensaje de tipo texto', { messageId: message.id, waId });

      // Procesar mensaje de texto directamente
      const textMessage = message as WhatsAppTextMessage;
      logger.debug('Contenido del mensaje de texto', {
        messageId: message.id,
        bodyLength: textMessage.text.body.length,
        bodyPreview: textMessage.text.body.substring(0, 50) + (textMessage.text.body.length > 50 ? '...' : '')
      });

      logger.info('Llamando al agente para procesar mensaje de texto', { messageId: message.id, waId });
      const response = await whatsappAgent.processTextMessage(waId, textMessage.text.body, message.id);
      logger.info('Respuesta del agente obtenida, enviando respuesta', { messageId: message.id, waId });
      logger.debug('Respuesta del agente generada', {
        messageId: message.id,
        responseLength: response.length,
        responsePreview: response.substring(0, 50) + (response.length > 50 ? '...' : '')
      });

      // Enviar respuesta vía WhatsApp
      logger.debug('Enviando respuesta vía WhatsApp', { messageId: message.id, waId });
      await whatsappService.sendTextMessage(waId, response);

      const duration = Date.now() - startTime;
      logger.info('✅ Mensaje de texto procesado y respondido exitosamente', {
        messageId: message.id,
        waId,
        responseLength: response.length,
        duration: `${duration}ms`
      });

    } else if (message.type === 'audio') {
      logger.debug('Procesando mensaje de tipo audio', { messageId: message.id, waId });

      // Procesar mensaje de voz: descargar → transcribir → procesar
      const mediaMessage = message as WhatsAppMediaMessage;
      const audioId = mediaMessage.audio?.id;

      if (!audioId) {
        throw new WhatsAppError('ID de audio no encontrado en mensaje');
      }

      logger.info('🎵 Procesando mensaje de voz', { audioId, waId, messageId: message.id });

      // Paso 1: Transcribir audio
      logger.debug('Iniciando transcripción de audio', { audioId, messageId: message.id });
      const transcriptionResult = await audioService.processWhatsAppAudio(audioId);

      if (!transcriptionResult.success || !transcriptionResult.text) {
        throw new WhatsAppError(`Error en transcripción: ${transcriptionResult.error || 'Unknown error'}`);
      }

      logger.info('📝 Audio transcrito exitosamente', {
        audioId,
        messageId: message.id,
        transcriptionLength: transcriptionResult.text.length,
        transcriptionPreview: transcriptionResult.text.substring(0, 50) + (transcriptionResult.text.length > 50 ? '...' : '')
      });

      // Paso 2: Procesar transcripción con el agente
      logger.debug('Procesando transcripción con el agente', { messageId: message.id, waId });
      logger.info('Llamando al agente para procesar mensaje de voz', { messageId: message.id, waId });
      const response = await whatsappAgent.processVoiceMessage(waId, transcriptionResult.text, message.id);
      logger.info('Respuesta del agente obtenida para mensaje de voz, enviando respuesta', { messageId: message.id, waId });

      // Paso 3: Enviar respuesta
      logger.debug('Enviando respuesta de voz vía WhatsApp', { messageId: message.id, waId });
      await whatsappService.sendTextMessage(waId, response);

      const duration = Date.now() - startTime;
      logger.info('✅ Mensaje de voz procesado y respondido exitosamente', {
        messageId: message.id,
        waId,
        audioId,
        transcriptionLength: transcriptionResult.text.length,
        responseLength: response.length,
        duration: `${duration}ms`
      });

    } else {
      logger.info('📨 Procesando mensaje de tipo no soportado', {
        messageId: message.id,
        waId,
        type: message.type
      });

      // Para otros tipos de mensaje, enviar respuesta genérica
      const response = `Recibí tu mensaje de tipo ${message.type}. Por ahora solo proceso mensajes de texto y voz.`;
      await whatsappService.sendTextMessage(waId, response);

      const duration = Date.now() - startTime;
      logger.info('📨 Mensaje de tipo no soportado procesado', {
        messageId: message.id,
        waId,
        type: message.type,
        duration: `${duration}ms`
      });
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error procesando mensaje entrante', {
      messageId: message.id,
      waId: message.from,
      type: message.type,
      duration: `${duration}ms`,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });

    // Intentar enviar mensaje de error al usuario
    try {
      const waId = message.from;
      logger.debug('Intentando enviar mensaje de error al usuario', { waId, messageId: message.id });
      await whatsappService.sendTextMessage(
        waId,
        `Lo siento, ocurrió un error procesando tu mensaje: ${errorMessage}`
      );
      logger.debug('Mensaje de error enviado exitosamente', { waId, messageId: message.id });
    } catch (sendError) {
      logger.error('❌ Error enviando mensaje de error al usuario', {
        waId: message.from,
        messageId: message.id,
        error: sendError instanceof Error ? sendError.message : String(sendError),
        stack: sendError instanceof Error ? sendError.stack : undefined
      });
    }
  }
}

// Crear aplicación Elysia
// Crear aplicación Elysia
const app = new Elysia()
  .onError(({ code, error, set }) => {
    // Función auxiliar para extraer mensaje de error de forma segura
    const getErrorMessage = (err: any): string => {
      if (err instanceof Error) return err.message;
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object' && 'message' in err) return String(err.message);
      return 'Unknown error';
    };

    const errorMessage = getErrorMessage(error);
    
    console.log('ERROR', error);
    
    switch (code) {
      case 'NOT_FOUND':
        set.status = 404;
        return {
          status: 404,
          message: `Route not found: ${errorMessage}`
        };
      
      case 'VALIDATION':
        set.status = 400;
        return {
          status: 400,
          message: `Validation failed: ${errorMessage}`,
          errors: 'validator' in error ? error.validator : undefined
        };
      
      default:
        set.status = 500;
        return {
          status: 500,
          message: `Internal Server Error: ${errorMessage}`
        };
    }
  })
  .use(healthRoutes)
  .use(webhookRoutes);

// Iniciar servidor
async function startServer() {
  try {
    await initializeApp();

    try {
    
      const server = app.listen(config.port);
    
      logger.info(`🚀 Servidor Elysia ejecutándose en puerto ${config.port}`);
      logger.info(`📱 Webhook URL: http://localhost:${config.port}/webhook`);
      logger.info(`💚 Health check: http://localhost:${config.port}/health`);
      logger.info(`💾 Estado de base de datos: ${isDatabaseAvailable ? 'Disponible' : 'No disponible (funcionando en memoria)'}`);
    } catch (listenError) {
      logger.error('❌ Error al iniciar el servidor HTTP', {
        error: listenError instanceof Error ? listenError.message : String(listenError),
        stack: listenError instanceof Error ? listenError.stack : undefined,
        port: config.port
      });
      throw listenError;
    }

  } catch (error) {
    logger.error('❌ Error iniciando servidor', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}

// Manejo de señales para cierre graceful
process.on('SIGINT', async () => {
  logger.info('🛑 Recibida señal SIGINT, cerrando servidor...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Recibida señal SIGTERM, cerrando servidor...');
  process.exit(0);
});

// Iniciar la aplicación
startServer().catch((error) => {
  logger.error('❌ Error fatal iniciando aplicación', {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

export default app;