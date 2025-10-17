import pino from 'pino';
import { config } from './config.js';

/**
 * Determina si estamos en modo desarrollo basado en NODE_ENV
 */
const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Configuración del logger usando Pino
 * En desarrollo usa pino-pretty para formato legible
 * En producción usa formato JSON estructurado
 */
const loggerConfig = isDevelopment
  ? {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }
  : {
      level: config.logLevel,
      formatters: {
        level: (label: string) => {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    };

/**
 * Instancia del logger configurada
 * Lista para usar en toda la aplicación
 */
export const logger = pino(loggerConfig);

/**
 * Función helper para logging de errores con contexto adicional
 */
export function logError(error: Error, context?: Record<string, any>) {
  logger.error({
    err: error,
    context,
  }, `Error: ${error.message}`);
}

/**
 * Función helper para logging de operaciones exitosas
 */
export function logSuccess(message: string, data?: Record<string, any>) {
  logger.info({ data }, message);
}

/**
 * Función helper para logging de operaciones de WhatsApp
 */
export function logWhatsApp(operation: string, phoneNumber?: string, messageId?: string) {
  logger.info({
    operation,
    phoneNumber,
    messageId,
  }, `WhatsApp ${operation}`);
}

/**
 * Función helper para logging de operaciones de base de datos
 */
export function logDatabase(operation: string, table?: string, recordId?: string) {
  logger.debug({
    operation,
    table,
    recordId,
  }, `Database ${operation}`);
}