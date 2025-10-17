import { SessionRepository, ConversationRepository, MessageRepository, getOrCreateConversation } from '../database/repositories.js';
import { AgentState, DatabaseMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Flag para indicar si la base de datos está disponible (se importa desde index.ts)
let isDatabaseAvailable = false;

// Función para establecer el estado de la base de datos
export function setDatabaseAvailability(available: boolean): void {
  isDatabaseAvailable = available;
}

/**
 * Clase para gestión de memoria conversacional del agente
 * Maneja el estado de la sesión, contexto histórico y limpieza automática
 */
export class AgentMemory {
  /**
    * Guardar el estado actual del agente en la base de datos
    */
   static async saveAgentState(userId: string, agentState: AgentState): Promise<void> {
     if (!isDatabaseAvailable) {
       logger.debug('Base de datos no disponible - estado del agente no guardado', { userId });
       return;
     }

     try {
       logger.debug('Intentando guardar estado del agente', {
         userId,
         sessionId: agentState.session_id,
         messageCount: agentState.messages.length,
         currentNode: agentState.current_node
       });
       await SessionRepository.saveAgentState(userId, agentState);
       logger.debug('Estado del agente guardado exitosamente', { userId, sessionId: agentState.session_id });
     } catch (error) {
       logger.error('Error al guardar estado del agente en memoria', {
         userId,
         sessionId: agentState.session_id,
         error: error instanceof Error ? error.message : String(error),
         stack: error instanceof Error ? error.stack : undefined
       });
       throw error;
     }
   }

  /**
    * Recuperar el estado del agente desde la base de datos
    */
   static async loadAgentState(userId: string): Promise<AgentState | null> {
     if (!isDatabaseAvailable) {
       logger.debug('Base de datos no disponible - estado del agente no cargado', { userId });
       return null;
     }

     try {
       logger.debug('Intentando cargar estado del agente', { userId });
       const agentState = await SessionRepository.getAgentState(userId);
       if (agentState) {
         logger.debug('Estado del agente cargado exitosamente', {
           userId,
           sessionId: agentState.session_id,
           messageCount: agentState.messages.length,
           currentNode: agentState.current_node
         });
       } else {
         logger.debug('No se encontró estado del agente en memoria', { userId });
       }
       return agentState;
     } catch (error) {
       logger.error('Error al cargar estado del agente desde memoria', {
         userId,
         error: error instanceof Error ? error.message : String(error),
         stack: error instanceof Error ? error.stack : undefined
       });
       throw error;
     }
   }

  /**
   * Obtener o crear conversación para un usuario
   */
  static async getOrCreateConversation(userId: string, title?: string): Promise<string> {
    if (!isDatabaseAvailable) {
      // Generar un ID único para la conversación en memoria
      const conversationId = `mem_${userId}_${Date.now()}`;
      logger.debug('Conversación creada en memoria (sin DB)', { userId, conversationId });
      return conversationId;
    }

    try {
      return await getOrCreateConversation(userId, title);
    } catch (error) {
      logger.error('Error al obtener o crear conversación en memoria', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Guardar mensaje en la conversación
   */
  static async saveMessage(
    conversationId: string,
    direction: 'incoming' | 'outgoing',
    messageType: string,
    content: string,
    whatsappMessageId?: string,
    timestamp?: Date
  ): Promise<string> {
    if (!isDatabaseAvailable) {
      // Generar un ID único para el mensaje en memoria
      const messageId = `msg_${conversationId}_${Date.now()}`;
      logger.debug('Mensaje guardado en memoria (sin DB)', { messageId, conversationId, direction });
      return messageId;
    }

    try {
      return await MessageRepository.saveMessage(
        conversationId,
        direction,
        messageType,
        content,
        whatsappMessageId,
        timestamp
      );
    } catch (error) {
      logger.error('Error al guardar mensaje en memoria', {
        conversationId,
        direction,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Recuperar mensajes recientes de la conversación para contexto
   */
  static async getConversationHistory(conversationId: string, limit: number = 20): Promise<DatabaseMessage[]> {
    if (!isDatabaseAvailable) {
      logger.debug('Base de datos no disponible - historial vacío', { conversationId });
      return [];
    }

    try {
      const messages = await MessageRepository.getConversationMessages(conversationId, limit);
      logger.debug('Historial de conversación recuperado', { conversationId, messageCount: messages.length });
      return messages;
    } catch (error) {
      logger.error('Error al recuperar historial de conversación', {
        conversationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Limpiar sesiones expiradas automáticamente
   */
  static async cleanupExpiredSessions(): Promise<number> {
    if (!isDatabaseAvailable) {
      logger.debug('Base de datos no disponible - limpieza de sesiones omitida');
      return 0;
    }

    try {
      const deletedCount = await SessionRepository.cleanupExpiredSessions();
      if (deletedCount > 0) {
        logger.info('Sesiones expiradas limpiadas automáticamente', { deletedCount });
      }
      return deletedCount;
    } catch (error) {
      logger.error('Error al limpiar sesiones expiradas', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Crear estado inicial del agente para una nueva conversación
   */
  static createInitialAgentState(sessionId: string, userId: string): AgentState {
    return {
      messages: [],
      session_id: sessionId,
      context: {
        user_id: userId,
        created_at: new Date(),
        conversation_type: 'whatsapp',
        preferences: {},
        metadata: {}
      },
      current_node: 'start'
    };
  }

  /**
   * Actualizar contexto del agente con nueva información
   */
  static updateAgentContext(agentState: AgentState, updates: Record<string, any>): AgentState {
    return {
      ...agentState,
      context: {
        ...agentState.context,
        ...updates,
        updated_at: new Date()
      }
    };
  }

  /**
   * Agregar mensaje al estado del agente
   */
  static addMessageToState(
    agentState: AgentState,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): AgentState {
    const newMessage = {
      role,
      content,
      timestamp: new Date()
    };

    return {
      ...agentState,
      messages: [...agentState.messages, newMessage]
    };
  }

  /**
   * Obtener mensajes recientes del estado del agente para contexto
   */
  static getRecentMessages(agentState: AgentState, limit: number = 10): Array<{ role: string; content: string }> {
    const recentMessages = agentState.messages.slice(-limit);
    return recentMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  /**
   * Limpiar estado del agente (útil para reiniciar conversación)
   */
  static clearAgentState(agentState: AgentState): AgentState {
    return {
      ...agentState,
      messages: [],
      context: {
        ...agentState.context,
        cleared_at: new Date()
      },
      current_node: 'start'
    };
  }
}