import { executeQuery, executeTransaction } from './client.js';
import { logger } from '../utils/logger.js';

/**
 * Definición del esquema de la base de datos
 * Contiene las estructuras de tablas para el agente conversacional
 */

/**
 * Tabla: users
 * Almacena información de los usuarios de WhatsApp
 * - id: UUID primario
 * - wa_id: ID único de WhatsApp
 * - phone_number: Número de teléfono
 * - profile_name: Nombre del perfil (opcional)
 * - created_at, updated_at: Timestamps
 * Índices: wa_id (único), phone_number
 */
export const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_id VARCHAR(255) NOT NULL UNIQUE,
    phone_number VARCHAR(20) NOT NULL,
    profile_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_users_wa_id ON users(wa_id);
  CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);
`;

/**
 * Tabla: conversations
 * Almacena conversaciones entre usuarios y el agente
 * - id: UUID primario
 * - user_id: Referencia al usuario
 * - title: Título de la conversación (opcional)
 * - created_at, updated_at: Timestamps
 * Índices: user_id, created_at
 */
export const CREATE_CONVERSATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
`;

/**
 * Tabla: messages
 * Almacena todos los mensajes de las conversaciones
 * - id: UUID primario
 * - conversation_id: Referencia a la conversación
 * - direction: 'incoming' o 'outgoing'
 * - message_type: tipo de mensaje (text, image, etc.)
 * - content: contenido del mensaje (JSON para media, texto plano para text)
 * - whatsapp_message_id: ID del mensaje en WhatsApp
 * - timestamp: cuando se recibió/envió
 * - status: estado del mensaje (opcional)
 * Índices: conversation_id, timestamp, whatsapp_message_id
 */
export const CREATE_MESSAGES_TABLE = `
  CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    message_type VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    whatsapp_message_id VARCHAR(255) UNIQUE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON messages(whatsapp_message_id);
`;

/**
 * Tabla: sessions
 * Almacena el estado de las sesiones del agente LangGraph
 * - id: UUID primario
 * - user_id: Referencia al usuario
 * - agent_state: estado serializado del agente (JSON)
 * - created_at, updated_at: Timestamps
 * - expires_at: cuando expira la sesión (opcional)
 * Índices: user_id, expires_at
 */
export const CREATE_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    agent_state JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`;

/**
 * Función para crear todas las tablas del esquema
 * Ejecuta las migraciones iniciales en orden correcto
 */
export async function createSchema(): Promise<void> {
  try {
    logger.info('Iniciando creación del esquema de base de datos');

    // Ejecutar creación de tablas en transacción
    await executeTransaction(async (client) => {
      // Crear extensión UUID si no existe
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

      // Crear tablas en orden de dependencias
      await client.query(CREATE_USERS_TABLE);
      logger.debug('Tabla users creada');

      await client.query(CREATE_CONVERSATIONS_TABLE);
      logger.debug('Tabla conversations creada');

      await client.query(CREATE_MESSAGES_TABLE);
      logger.debug('Tabla messages creada');

      await client.query(CREATE_SESSIONS_TABLE);
      logger.debug('Tabla sessions creada');
    });

    logger.info('Esquema de base de datos creado exitosamente');
  } catch (error) {
    logger.error('Error al crear el esquema de base de datos', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Función para verificar si el esquema existe y está completo
 */
export async function validateSchema(): Promise<boolean> {
  try {
    const tables = await executeQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('users', 'conversations', 'messages', 'sessions')
    `);

    const existingTables = tables.map((row: any) => row.table_name);
    const requiredTables = ['users', 'conversations', 'messages', 'sessions'];

    const missingTables = requiredTables.filter(table => !existingTables.includes(table));

    if (missingTables.length > 0) {
      logger.warn('Tablas faltantes en el esquema', { missingTables });
      return false;
    }

    logger.debug('Esquema de base de datos validado correctamente');
    return true;
  } catch (error) {
    logger.error('Error al validar el esquema de base de datos', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Función para limpiar todas las tablas (útil para tests)
 * ¡CUIDADO! Borra todos los datos
 */
export async function dropSchema(): Promise<void> {
  try {
    logger.warn('Eliminando todas las tablas del esquema');

    await executeTransaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS sessions CASCADE');
      await client.query('DROP TABLE IF EXISTS messages CASCADE');
      await client.query('DROP TABLE IF EXISTS conversations CASCADE');
      await client.query('DROP TABLE IF EXISTS users CASCADE');
    });

    logger.info('Esquema de base de datos eliminado');
  } catch (error) {
    logger.error('Error al eliminar el esquema de base de datos', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}