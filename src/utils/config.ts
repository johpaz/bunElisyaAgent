import { ValidationError } from '../types/index.js';
import { z } from 'zod';
import { envSchema, type EnvVars } from './env.js';

/**
 * Interfaz para la configuración validada del proyecto
 */
interface AppConfig {
  // WhatsApp/Meta API
  metaToken: string;
  metaVerifyToken: string;
  metaBaseUrl: string;
  whatsappPhoneNumberId: string;

  // Base de datos (opcional)
  databaseUrl?: string;

  // Servidor
  port: number;

  // Logging
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

  // Opcionales
  apiKeyOpenAI?: string;
  openAIModel: string;
  openAITimeout: number;
}

/**
 * Función para validar las variables de entorno usando Zod
 */
function validateEnvironment(): EnvVars {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue: z.ZodIssue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
      throw new ValidationError(`Errores de validación de variables de entorno: ${issues}`, 'ENV_VALIDATION');
    }
    throw new ValidationError('Error desconocido durante la validación de variables de entorno', 'ENV_VALIDATION');
  }
}

/**
 * Configuración validada de la aplicación
 * Se valida una sola vez al importar el módulo
 */
export const config: AppConfig = (() => {
  try {
    const env = validateEnvironment();

    return {
      // WhatsApp/Meta API - todas requeridas
      metaToken: env.META_TOKEN,
      metaVerifyToken: env.META_VERIFY_TOKEN,
      metaBaseUrl: env.META_BASE_URL,
      whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,

      // Base de datos - opcional
      databaseUrl: env.DATABASE_URL,

      // Servidor - con valor por defecto
      port: env.PORT,

      // Logging - con valor por defecto
      logLevel: env.LOG_LEVEL,

      // Opcionales
      apiKeyOpenAI: env.API_KEY_OPENAI,
      openAIModel: env.OPENAI_MODELS,
      openAITimeout: env.OPENAI_TIMEOUT,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(`Error de validación de configuración: ${error.message}`);
      if (error.field) {
        console.error(`Campo problemático: ${error.field}`);
      }
    } else {
      console.error('Error desconocido durante la validación de configuración:', error);
    }
    process.exit(1); // Salir con error si la configuración es inválida
  }
})();

/**
 * Función para verificar que la configuración esté completa
 * Útil para tests o validaciones manuales
 */
export function validateConfig(): boolean {
  try {
    // Revalidar las variables de entorno usando Zod
    validateEnvironment();
    return true;
  } catch (error) {
    return false;
  }
}