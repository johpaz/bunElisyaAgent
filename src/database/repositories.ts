import { executeQuery, executeTransaction } from './client.js';
import { logger } from '../utils/logger.js';
import {
  DatabaseUser,
  DatabaseMessage,
  DatabaseSession,
  AgentState,
  ValidationError
} from '../types/index.js';

/**
 * Repositorios para operaciones CRUD en la base de datos
 * Incluye validación de datos y manejo de transacciones
 */

/**
 * Repositorio para operaciones con usuarios
 */
export class UserRepository {
  /**
   * Crear o actualizar un usuario
   */
  static async upsertUser(waId: string, phoneNumber: string, profileName?: string): Promise<DatabaseUser> {
    try {
      const query = `
        INSERT INTO users (wa_id, phone_number, profile_name, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (wa_id)
        DO UPDATE SET
          phone_number = EXCLUDED.phone_number,
          profile_name = COALESCE(EXCLUDED.profile_name, users.profile_name),
          updated_at = NOW()
        RETURNING *
      `;

      const result = await executeQuery<DatabaseUser>(query, [waId, phoneNumber, profileName]);
      logger.debug('Usuario upsert exitoso', { waId, userId: result[0]?.id });
      return result[0];
    } catch (error) {
      logger.error('Error al upsert usuario', { waId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Obtener usuario por WA ID
   */
  static async getUserByWaId(waId: string): Promise<DatabaseUser | null> {
    try {
      const query = 'SELECT * FROM users WHERE wa_id = $1';
      const result = await executeQuery<DatabaseUser>(query, [waId]);
      return result[0] || null;
    } catch (error) {
      logger.error('Error al obtener usuario por WA ID', { waId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Obtener usuario por ID
   */
  static async getUserById(id: string): Promise<DatabaseUser | null> {
    try {
      const query = 'SELECT * FROM users WHERE id = $1';
      const result = await executeQuery<DatabaseUser>(query, [id]);
      return result[0] || null;
    } catch (error) {
      logger.error('Error al obtener usuario por ID', { id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

/**
 * Repositorio para operaciones con conversaciones
 */
export class ConversationRepository {
  /**
   * Crear una nueva conversación
   */
  static async createConversation(userId: string, title?: string): Promise<string> {
    try {
      const query = `
        INSERT INTO conversations (user_id, title)
        VALUES ($1, $2)
        RETURNING id
      `;

      const result = await executeQuery<{ id: string }>(query, [userId, title]);
      const conversationId = result[0].id;
      logger.debug('Conversación creada', { userId, conversationId });
      return conversationId;
    } catch (error) {
      logger.error('Error al crear conversación', { userId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Obtener conversaciones de un usuario
   */
  static async getUserConversations(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const query = `
        SELECT c.*, COUNT(m.id) as message_count
        FROM conversations c
        LEFT JOIN messages m ON c.id = m.conversation_id
        WHERE c.user_id = $1
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT $2
      `;

      const result = await executeQuery(query, [userId, limit]);
      return result;
    } catch (error) {
      logger.error('Error al obtener conversaciones del usuario', { userId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Obtener conversación por ID
   */
  static async getConversationById(id: string): Promise<any | null> {
    try {
      const query = 'SELECT * FROM conversations WHERE id = $1';
      const result = await executeQuery(query, [id]);
      return result[0] || null;
    } catch (error) {
      logger.error('Error al obtener conversación por ID', { id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Actualizar timestamp de conversación
   */
  static async updateConversationTimestamp(conversationId: string): Promise<void> {
    try {
      const query = 'UPDATE conversations SET updated_at = NOW() WHERE id = $1';
      await executeQuery(query, [conversationId]);
    } catch (error) {
      logger.error('Error al actualizar timestamp de conversación', { conversationId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

/**
 * Repositorio para operaciones con mensajes
 */
export class MessageRepository {
  /**
   * Guardar un mensaje en una conversación
   */
  static async saveMessage(
    conversationId: string,
    direction: 'incoming' | 'outgoing',
    messageType: string,
    content: string,
    whatsappMessageId?: string,
    timestamp?: Date
  ): Promise<string> {
    try {
      // Validar datos
      if (!conversationId || !direction || !messageType || !content) {
        throw new Error('Datos requeridos faltantes para guardar mensaje');
      }

      const query = `
        INSERT INTO messages (conversation_id, direction, message_type, content, whatsapp_message_id, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `;

      const messageTimestamp = timestamp || new Date();
      const result = await executeQuery<{ id: string }>(query, [
        conversationId,
        direction,
        messageType,
        content,
        whatsappMessageId,
        messageTimestamp
      ]);

      const messageId = result[0].id;

      // Actualizar timestamp de la conversación
      await ConversationRepository.updateConversationTimestamp(conversationId);

      logger.debug('Mensaje guardado', { messageId, conversationId, direction });
      return messageId;
    } catch (error) {
      logger.error('Error al guardar mensaje', {
        conversationId,
        direction,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Obtener mensajes de una conversación
   */
  static async getConversationMessages(
    conversationId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<DatabaseMessage[]> {
    try {
      const query = `
        SELECT m.*, c.user_id
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.conversation_id = $1
        ORDER BY m.timestamp DESC
        LIMIT $2 OFFSET $3
      `;

      const result = await executeQuery<DatabaseMessage>(query, [conversationId, limit, offset]);
      return result;
    } catch (error) {
      logger.error('Error al obtener mensajes de conversación', {
        conversationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Obtener mensaje por WhatsApp ID
   */
  static async getMessageByWhatsAppId(whatsappMessageId: string): Promise<DatabaseMessage | null> {
    try {
      const query = 'SELECT * FROM messages WHERE whatsapp_message_id = $1';
      const result = await executeQuery<DatabaseMessage>(query, [whatsappMessageId]);
      return result[0] || null;
    } catch (error) {
      logger.error('Error al obtener mensaje por WhatsApp ID', {
        whatsappMessageId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Actualizar estado de mensaje
   */
  static async updateMessageStatus(messageId: string, status: string): Promise<void> {
    try {
      const query = 'UPDATE messages SET status = $1 WHERE id = $2';
      await executeQuery(query, [status, messageId]);
      logger.debug('Estado de mensaje actualizado', { messageId, status });
    } catch (error) {
      logger.error('Error al actualizar estado de mensaje', {
        messageId,
        status,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

/**
 * Función simplificada de validación para AgentState
 */
function validateAgentState(agentState: any): asserts agentState is AgentState {
  if (!agentState || typeof agentState !== 'object') {
    throw new ValidationError('AgentState debe ser un objeto válido');
  }

  if (!Array.isArray(agentState.messages)) {
    throw new ValidationError('AgentState.messages debe ser un array');
  }

  if (typeof agentState.session_id !== 'string' || agentState.session_id.trim() === '') {
    throw new ValidationError('AgentState.session_id debe ser un string no vacío');
  }

  if (!agentState.context || typeof agentState.context !== 'object') {
    throw new ValidationError('AgentState.context debe ser un objeto');
  }
}

/**
 * Repositorio para operaciones con sesiones del agente
 */
export class SessionRepository {
  /**
   * Guardar o actualizar estado de sesión del agente
   */
  static async saveAgentState(userId: string, agentState: AgentState): Promise<string> {
    try {
      logger.debug('Iniciando guardado de estado del agente', {
        userId,
        sessionId: agentState.session_id,
        messageCount: agentState.messages.length,
        currentNode: agentState.current_node,
        timestamp: new Date().toISOString()
      });

      // Validar datos de entrada
      if (!userId || userId.trim() === '') {
        throw new ValidationError('userId es requerido y no puede estar vacío');
      }

      if (!agentState) {
        throw new ValidationError('agentState es requerido');
      }

      // Validar estructura básica del AgentState
      validateAgentState(agentState);

      let serializedState: string;
      try {
        // Crear copia del estado para serialización segura
        const safeAgentState = {
          ...agentState,
          messages: agentState.messages.map(msg => ({
            ...msg,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp
          })),
          context: Object.fromEntries(
            Object.entries(agentState.context || {}).filter(([_, value]) =>
              value !== undefined &&
              typeof value !== 'function' &&
              typeof value !== 'symbol' &&
              !Number.isNaN(value) &&
              value !== Infinity &&
              value !== -Infinity &&
              typeof value !== 'bigint'
            )
          )
        };

        logger.debug('Serializando estado del agente a JSON', {
          userId,
          messageCount: safeAgentState.messages.length,
          contextKeys: Object.keys(safeAgentState.context),
          currentNode: safeAgentState.current_node
        });

        serializedState = JSON.stringify(safeAgentState);

        logger.debug('Estado serializado exitosamente', {
          userId,
          serializedLength: serializedState.length
        });

      } catch (serializeError) {
        logger.error('Error al serializar estado del agente a JSON', {
          userId,
          error: serializeError instanceof Error ? serializeError.message : String(serializeError)
        });
        throw new ValidationError('No se pudo serializar el estado del agente');
      }

      const query = `
        INSERT INTO sessions (user_id, agent_state, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          agent_state = EXCLUDED.agent_state,
          updated_at = NOW()
        RETURNING id
      `;

      logger.debug('Ejecutando query para guardar estado del agente', {
        userId,
        query: query.replace(/\s+/g, ' ').trim(),
        paramTypes: [typeof userId, typeof serializedState],
        paramLengths: [userId.length, serializedState.length]
      });

      const result = await executeQuery<{ id: string }>(query, [userId, serializedState]);

      logger.debug('Resultado de query de guardado de estado', {
        userId,
        resultCount: result.length,
        hasResult: result.length > 0,
        result: result[0]
      });

      const sessionId = result[0].id;

      logger.info('Estado del agente guardado exitosamente', {
        userId,
        sessionId,
        serializedSize: serializedState.length,
        timestamp: new Date().toISOString()
      });

      return sessionId;
    } catch (error) {
      if (error instanceof ValidationError) {
        logger.error('Error de validación al guardar estado del agente', {
          userId,
          error: error.message,
          validationField: error.field
        });
        throw error;
      }

      // Log detallado del error de PostgreSQL
      const pgError = error as any;
      logger.error('Error al guardar estado del agente - Detalles PostgreSQL', {
        userId,
        errorMessage: pgError.message,
        errorCode: pgError.code,
        errorSeverity: pgError.severity,
        errorDetail: pgError.detail,
        errorHint: pgError.hint,
        errorPosition: pgError.position,
        errorInternalPosition: pgError.internalPosition,
        errorInternalQuery: pgError.internalQuery,
        errorWhere: pgError.where,
        errorSchema: pgError.schema,
        errorTable: pgError.table,
        errorColumn: pgError.column,
        errorDataType: pgError.dataType,
        errorConstraint: pgError.constraint,
        errorFile: pgError.file,
        errorLine: pgError.line,
        errorRoutine: pgError.routine,
        errorContext: pgError.context,
        errorSource: pgError.source,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Obtener estado de sesión del agente
   */
  static async getAgentState(userId: string): Promise<AgentState | null> {
    try {
      logger.debug('Iniciando consulta de estado del agente', {
        userId,
        timestamp: new Date().toISOString()
      });

      const query = `
        SELECT agent_state FROM sessions
        WHERE user_id = $1
        AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY updated_at DESC
        LIMIT 1
      `;

      logger.debug('Ejecutando query para obtener estado del agente', {
        userId,
        query: query.replace(/\s+/g, ' ').trim(),
        params: [userId]
      });

      const result = await executeQuery<{ agent_state: AgentState }>(query, [userId]);

      logger.debug('Resultado de query de estado del agente', {
        userId,
        resultCount: result.length,
        hasResult: result.length > 0
      });

      if (!result[0]) {
        logger.info('No se encontró estado del agente para el usuario', {
          userId,
          reason: 'No existe registro en sessions'
        });
        return null;
      }

      try {
        // El driver de pg ya deserializa el JSONB
        const agentState = result[0].agent_state;

        logger.debug('Estado del agente deserializado exitosamente', {
          userId,
          sessionId: agentState.session_id,
          messageCount: agentState.messages.length,
          currentNode: agentState.current_node
        });

        return agentState;
      } catch (e) {
        logger.error('Error al procesar el estado del agente desde la base de datos', {
          userId,
          error: e instanceof Error ? e.message : String(e),
          agentStateFromDB: result[0].agent_state,
        });
        return null;
      }
    } catch (error) {
      logger.error('Error al obtener estado del agente', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Limpiar sesiones expiradas
   */
  static async cleanupExpiredSessions(): Promise<number> {
    try {
      const query = 'DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= NOW()';
      const result = await executeQuery(query);
      const deletedCount = result.length;
      logger.debug('Sesiones expiradas limpiadas', { deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Error al limpiar sesiones expiradas', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Establecer expiración de sesión
   */
  static async setSessionExpiry(sessionId: string, expiresAt: Date): Promise<void> {
    try {
      const query = 'UPDATE sessions SET expires_at = $1 WHERE id = $2';
      await executeQuery(query, [expiresAt, sessionId]);
      logger.debug('Expiración de sesión establecida', { sessionId, expiresAt });
    } catch (error) {
      logger.error('Error al establecer expiración de sesión', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

/**
 * Función helper para obtener o crear conversación para un usuario
 * Útil para mantener el contexto conversacional
 */
export async function getOrCreateConversation(userId: string, title?: string): Promise<string> {
  try {
    // Buscar conversación más reciente del usuario
    const conversations = await ConversationRepository.getUserConversations(userId, 1);

    if (conversations.length > 0) {
      // Retornar conversación existente
      return conversations[0].id;
    } else {
      // Crear nueva conversación
      return await ConversationRepository.createConversation(userId, title);
    }
  } catch (error) {
    logger.error('Error al obtener o crear conversación', {
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}