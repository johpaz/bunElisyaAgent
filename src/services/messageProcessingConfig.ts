import { MessageProcessingConfig, MessageType } from '../types/messageProcessing.js';

/**
 * Configuraciones por defecto para el procesamiento de mensajes
 * Define qué tipos de mensaje están habilitados y configuraciones generales
 */
export const defaultMessageProcessingConfig: MessageProcessingConfig = {
  enabledTypes: [
    MessageType.TEXT,
    MessageType.IMAGE,
    MessageType.AUDIO,
    MessageType.VIDEO,
    MessageType.DOCUMENT,
    MessageType.LOCATION,
    MessageType.CONTACT,
    MessageType.STICKER
  ],
  defaultProcessor: undefined, // No hay procesador por defecto inicialmente
  timeout: 30000, // 30 segundos timeout
  retryAttempts: 3
};

/**
 * Configuración para desarrollo con tipos limitados
 */
export const developmentConfig: MessageProcessingConfig = {
  ...defaultMessageProcessingConfig,
  enabledTypes: [
    MessageType.TEXT,
    MessageType.IMAGE
  ],
  timeout: 10000 // 10 segundos para desarrollo
};

/**
 * Configuración para producción con todos los tipos habilitados
 */
export const productionConfig: MessageProcessingConfig = {
  ...defaultMessageProcessingConfig,
  timeout: 45000, // 45 segundos para producción
  retryAttempts: 5
};

/**
 * Función helper para obtener configuración según el entorno
 */
export function getConfigForEnvironment(env: string = process.env.NODE_ENV || 'development'): MessageProcessingConfig {
  switch (env.toLowerCase()) {
    case 'production':
      return productionConfig;
    case 'development':
      return developmentConfig;
    default:
      return defaultMessageProcessingConfig;
  }
}