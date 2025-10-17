import { z } from 'zod';

/**
 * Esquema Zod para validar las variables de entorno requeridas
 */
export const envSchema = z.object({
  // WhatsApp/Meta API - todas requeridas
  META_TOKEN: z.string().min(1, 'META_TOKEN es requerido'),
  META_VERIFY_TOKEN: z.string().min(1, 'META_VERIFY_TOKEN es requerido'),
  META_BASE_URL: z.string().min(1, 'META_BASE_URL es requerido'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, 'WHATSAPP_PHONE_NUMBER_ID es requerido'),

  // Base de datos - opcional
  DATABASE_URL: z.string().optional(),

  // Servidor - opcional con valor por defecto
  PORT: z.string().optional().transform((val) => val ? parseInt(val, 10) : 3000),

  // Logging - opcional con valor por defecto
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional().default('info'),

  // Opcionales
  API_KEY_OPENAI: z.string().optional(),
  OPENAI_MODELS: z.string().optional().default('gpt-5-nano'),
  OPENAI_TIMEOUT: z.string().optional().transform((val) => val ? parseInt(val, 10) : 30000),
});

/**
 * Tipo inferido del esquema de entorno
 */
export type EnvVars = z.infer<typeof envSchema>;