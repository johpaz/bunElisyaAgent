import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentMemory } from './memory.js';
import { getToolsForLangGraph, getToolByName } from './tools.js';
import { AgentState, LangGraphMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { UserRepository } from '../database/repositories.js';
import { getOpenAIService } from '../services/openaiService.js';

/**
 * Nodo inicial del grafo - procesa entrada del usuario
 */
async function processInput(state: AgentState): Promise<AgentState> {
  try {
    logger.debug('Procesando entrada del usuario', { sessionId: state.session_id });

    // Obtener el último mensaje del usuario
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('No se encontró mensaje de usuario para procesar');
    }

    // Agregar mensaje del sistema para contexto
    const systemMessage = {
      role: 'system' as const,
      content: 'Eres un asistente conversacional útil para WhatsApp. Usa las herramientas disponibles cuando sea necesario.',
      timestamp: new Date()
    };

    return {
      ...state,
      messages: [...state.messages, systemMessage],
      current_node: 'analyze'
    };
  } catch (error) {
    logger.error('Error en processInput', { error: error instanceof Error ? error.message : String(error) });
    return {
      ...state,
      current_node: 'error'
    };
  }
}

/**
 * Nodo de análisis - determina si usar herramientas o responder directamente
 */
async function analyzeIntent(state: AgentState): Promise<AgentState> {
  try {
    logger.debug('Analizando intención del usuario', { sessionId: state.session_id });

    const lastUserMessage = state.messages.filter(m => m.role === 'user').pop();
    if (!lastUserMessage) {
      return { ...state, current_node: 'respond' };
    }

    const content = lastUserMessage.content.toLowerCase();

    // Patrones simples para determinar uso de herramientas
    const toolPatterns = {
      'get_current_time': ['hora', 'tiempo', 'fecha'],
      'web_search': ['buscar', 'busca', 'investigar', 'noticias'],
      'calculator': ['calcular', 'suma', 'resta', 'multiplica', 'divide', '+', '-', '*', '/'],
      'remember_info': ['recuerda', 'guarda', 'memoria'],
      'courtesy_response': ['hola', 'gracias', 'adiós', 'ayuda', 'disculpa']
    };

    // Buscar herramienta apropiada
    for (const [toolName, patterns] of Object.entries(toolPatterns)) {
      if (patterns.some(pattern => content.includes(pattern))) {
        return {
          ...state,
          context: {
            ...state.context,
            selected_tool: toolName,
            tool_input: extractToolInput(content, toolName, state.context.user_id)
          },
          current_node: 'use_tool'
        };
      }
    }

    // Si no se identifica herramienta específica, responder directamente
    return { ...state, current_node: 'respond' };
  } catch (error) {
    logger.error('Error en analyzeIntent', { error: error instanceof Error ? error.message : String(error) });
    return { ...state, current_node: 'error' };
  }
}

/**
 * Mapear contenido a tipo de respuesta de cortesía
 */
function mapContentToCourtesyType(content: string): 'greeting' | 'thanks' | 'goodbye' | 'apology' | 'help' {
  const lowerContent = content.toLowerCase();
  if (lowerContent.includes('hola') || lowerContent.includes('buenos')) {
    return 'greeting';
  } else if (lowerContent.includes('gracias')) {
    return 'thanks';
  } else if (lowerContent.includes('adiós') || lowerContent.includes('chau')) {
    return 'goodbye';
  } else if (lowerContent.includes('disculpa')) {
    return 'apology';
  } else if (lowerContent.includes('ayuda')) {
    return 'help';
  }
  return 'help'; // default
}

/**
 * Extraer entrada para herramienta desde el mensaje
 */
function extractToolInput(content: string, toolName: string, userId: string): any {
  switch (toolName) {
    case 'web_search':
      // Extraer términos de búsqueda
      const searchTerms = content.replace(/^(busca|buscar|investiga)/i, '').trim();
      return { query: searchTerms };

    case 'calculator':
      // Extraer expresión matemática
      const mathExpression = content.replace(/^(calcula|calcular)/i, '').trim();
      return { expression: mathExpression };

    case 'remember_info':
      // Extraer información a recordar (lógica simplificada)
      return { key: 'info', value: content, userId };

    case 'courtesy_response':
      // Mapear a tipo de respuesta de cortesía
      const type = mapContentToCourtesyType(content);
      return { type };

    default:
      return {};
  }
}

/**
 * Nodo de uso de herramientas
 */
async function useTool(state: AgentState): Promise<AgentState> {
  try {
    const selectedTool = state.context.selected_tool as string;
    const toolInput = state.context.tool_input;

    logger.debug('Usando herramienta', { sessionId: state.session_id, tool: selectedTool });

    const tool = getToolByName(selectedTool);
    if (!tool) {
      throw new Error(`Herramienta no encontrada: ${selectedTool}`);
    }

    const toolResult = await tool.execute(toolInput);

    // Agregar resultado como mensaje del asistente
    const toolMessage = {
      role: 'assistant' as const,
      content: toolResult,
      timestamp: new Date()
    };

    return {
      ...state,
      messages: [...state.messages, toolMessage],
      context: {
        ...state.context,
        tool_result: toolResult,
        selected_tool: undefined,
        tool_input: undefined
      },
      current_node: 'finalize'
    };
  } catch (error) {
    logger.error('Error al usar herramienta', { error: error instanceof Error ? error.message : String(error) });

    const errorMessage = {
      role: 'assistant' as const,
      content: 'Lo siento, tuve un problema al procesar tu solicitud.',
      timestamp: new Date()
    };

    return {
      ...state,
      messages: [...state.messages, errorMessage],
      current_node: 'finalize'
    };
  }
}

/**
 * Nodo de respuesta directa usando OpenAI
 */
async function generateResponse(state: AgentState): Promise<AgentState> {
  try {
    logger.debug('Generando respuesta con OpenAI', { sessionId: state.session_id });

    const lastUserMessage = state.messages.filter(m => m.role === 'user').pop();
    const userContent = lastUserMessage?.content || '';

    // Intentar generar respuesta con OpenAI
    const openAIService = getOpenAIService();
    const aiResponse = await openAIService.generateResponse(userContent);

    // Usar respuesta de OpenAI o fallback
    const response = aiResponse || 'Entiendo tu mensaje. ¿En qué más puedo ayudarte?';

    const responseMessage = {
      role: 'assistant' as const,
      content: response,
      timestamp: new Date()
    };

    return {
      ...state,
      messages: [...state.messages, responseMessage],
      current_node: 'finalize'
    };
  } catch (error) {
    logger.error('Error al generar respuesta con OpenAI', { error: error instanceof Error ? error.message : String(error) });

    // Fallback a respuestas estáticas
    const lastUserMessage = state.messages.filter(m => m.role === 'user').pop();
    const userContent = lastUserMessage?.content || '';
    let response = 'Entiendo tu mensaje. ¿En qué más puedo ayudarte?';

    if (userContent.toLowerCase().includes('hola') || userContent.toLowerCase().includes('buenos')) {
      response = '¡Hola! ¿Cómo estás? Estoy aquí para ayudarte.';
    } else if (userContent.toLowerCase().includes('gracias')) {
      response = '¡De nada! ¿Hay algo más en lo que pueda asistirte?';
    } else if (userContent.toLowerCase().includes('adiós') || userContent.toLowerCase().includes('chau')) {
      response = '¡Hasta luego! Que tengas un excelente día.';
    }

    const responseMessage = {
      role: 'assistant' as const,
      content: response,
      timestamp: new Date()
    };

    return {
      ...state,
      messages: [...state.messages, responseMessage],
      current_node: 'finalize'
    };
  }
}

/**
 * Nodo de finalización - guarda estado y prepara respuesta final
 */
async function finalizeResponse(state: AgentState): Promise<AgentState> {
  try {
    logger.debug('Finalizando respuesta', { sessionId: state.session_id });

    // Guardar estado actualizado en memoria
    await AgentMemory.saveAgentState(state.context.user_id, state);

    return {
      ...state,
      current_node: END
    };
  } catch (error) {
    logger.error('Error al finalizar respuesta', { error: error instanceof Error ? error.message : String(error) });
    return { ...state, current_node: 'error' };
  }
}

/**
 * Nodo de manejo de errores
 */
async function handleError(state: AgentState): Promise<AgentState> {
  try {
    logger.warn('Manejando error en el flujo del agente', { sessionId: state.session_id });

    const errorMessage = {
      role: 'assistant' as const,
      content: 'Lo siento, ocurrió un error interno. Por favor, intenta de nuevo.',
      timestamp: new Date()
    };

    return {
      ...state,
      messages: [...state.messages, errorMessage],
      current_node: END
    };
  } catch (error) {
    logger.error('Error crítico en handleError', { error: error instanceof Error ? error.message : String(error) });
    return state;
  }
}

/**
 * Clase principal del agente WhatsApp con LangGraph
 */
export class WhatsAppAgent {
  private graph: any; // Usamos any por simplicidad ya que LangGraph tiene tipos complejos

  constructor() {
    // Por simplicidad, implementaremos el flujo sin LangGraph por ahora
    // y usaremos un enfoque más directo
    this.graph = null;
    logger.info('Agente WhatsApp inicializado (simplificado sin LangGraph completo)');
  }

  /**
    * Procesar mensaje de texto de WhatsApp
    */
   async processTextMessage(waId: string, messageContent: string, waMessageId?: string, profileName?: string): Promise<string> {
     try {
       // Validación inicial de inputs
       if (!waId || typeof waId !== 'string' || waId.trim() === '') {
         throw new Error('waId es requerido y debe ser una cadena no vacía');
       }
       if (!messageContent || typeof messageContent !== 'string' || messageContent.trim() === '') {
         throw new Error('messageContent es requerido y debe ser una cadena no vacía');
       }

       logger.info('Procesando mensaje de texto', {
         waId,
         profileName,
         messageLength: messageContent.length,
         waMessageId,
         timestamp: new Date().toISOString()
       });

       logger.debug('Iniciando procesamiento interno del mensaje de texto', { waId, messageId: waMessageId });

       // Obtener o crear usuario
       let user = await UserRepository.getUserByWaId(waId);
       if (!user) {
         logger.debug('Creando nuevo usuario', { waId, profileName });
         user = await UserRepository.upsertUser(waId, waId, profileName); // Asumimos que phoneNumber es el mismo que waId inicialmente
       }
       const userId = user.id;

       // Cargar o crear estado del agente
       logger.debug('Cargando estado del agente para usuario', { userId });
       let agentState = await AgentMemory.loadAgentState(userId);
       if (!agentState) {
         logger.debug('Creando nuevo estado del agente', { userId });
         const conversationId = await AgentMemory.getOrCreateConversation(userId, 'WhatsApp Conversation');
         agentState = AgentMemory.createInitialAgentState(conversationId, userId);
         logger.debug('Estado inicial del agente creado', { userId, conversationId });
       }

       // Agregar mensaje del usuario al estado
       agentState = AgentMemory.addMessageToState(agentState, 'user', messageContent);
       logger.debug('Mensaje del usuario agregado al estado', {
         userId,
         messageCount: agentState.messages.length
       });

       if (messageContent.toLowerCase().includes('ping')) {
         return 'pong';
       }

       let response: string;
       try {
         response = await this.processMessageWithLogic(agentState, messageContent);
         if (!response) {
           response = 'No te entiendo. ¿Puedes intentar de nuevo?';
         }
       } catch (error) {
         const errorMessage = error instanceof Error ? error.message : String(error);
         if (errorMessage.toLowerCase().includes('tool') || errorMessage.toLowerCase().includes('herramienta')) {
           logger.error('Problema con herramienta detectado', { waId, error: errorMessage });
         } else if (errorMessage.toLowerCase().includes('estado') || errorMessage.toLowerCase().includes('state') || errorMessage.toLowerCase().includes('validation')) {
           logger.error('Error de validación de estado', { waId, error: errorMessage });
         } else {
           logger.error('Fallo en el procesamiento del mensaje', { waId, error: errorMessage });
         }
         response = 'Lo siento, tuve un problema interno al procesar tu mensaje.';
       }

       // Actualizar estado con respuesta
       agentState = AgentMemory.addMessageToState(agentState, 'assistant', response);

       // Guardar estado actualizado con manejo de errores mejorado
       logger.debug('Guardando estado actualizado del agente', { userId });
       try {
         await AgentMemory.saveAgentState(userId, agentState);
       } catch (saveStateError) {
         logger.error('Error al guardar estado del agente, continuando con el procesamiento', {
           userId,
           error: saveStateError instanceof Error ? saveStateError.message : String(saveStateError)
         });
         // No lanzamos error aquí para no interrumpir el flujo
       }

       // Guardar mensaje en base de datos con manejo de errores mejorado
       logger.debug('Guardando mensaje entrante en base de datos', { userId, waMessageId });
       try {
         await AgentMemory.saveMessage(
           agentState.session_id,
           'incoming',
           'text',
           messageContent,
           waMessageId
         );
       } catch (saveIncomingError) {
         logger.error('Error al guardar mensaje entrante, continuando con el procesamiento', {
           userId,
           sessionId: agentState.session_id,
           error: saveIncomingError instanceof Error ? saveIncomingError.message : String(saveIncomingError)
         });
         // No lanzamos error aquí para no interrumpir el flujo
       }

       // Guardar respuesta en base de datos con manejo de errores mejorado
       logger.debug('Guardando respuesta saliente en base de datos', { userId });
       try {
         await AgentMemory.saveMessage(
           agentState.session_id,
           'outgoing',
           'text',
           response
         );
       } catch (saveOutgoingError) {
         logger.error('Error al guardar respuesta saliente, continuando con el procesamiento', {
           userId,
           sessionId: agentState.session_id,
           error: saveOutgoingError instanceof Error ? saveOutgoingError.message : String(saveOutgoingError)
         });
         // No lanzamos error aquí para no interrumpir el flujo
       }

       logger.info('Mensaje procesado exitosamente', {
         userId,
         responseLength: response.length,
         totalMessages: agentState.messages.length
       });
       logger.debug('Finalizando procesamiento del mensaje de texto', { waId, messageId: waMessageId });
       return response;
     } catch (error) {
       logger.error('Error al procesar mensaje de texto', {
         waId,
         waMessageId,
         error: error instanceof Error ? error.message : String(error),
         stack: error instanceof Error ? error.stack : undefined
       });
       return 'Lo siento, ocurrió un error al procesar tu mensaje.';
     }
   }

  /**
   * Procesar mensaje usando lógica simplificada con OpenAI
   */
  private async processMessageWithLogic(agentState: AgentState, messageContent: string): Promise<string> {
    const content = messageContent.toLowerCase();

    // Intentar usar herramientas basadas en patrones
    const toolPatterns = {
      'get_current_time': ['hora', 'tiempo', 'fecha'],
      'web_search': ['buscar', 'busca', 'investigar', 'noticias'],
      'calculator': ['calcular', 'suma', 'resta', 'multiplica', 'divide', '+', '-', '*', '/'],
      'courtesy_response': ['hola', 'gracias', 'adiós', 'ayuda', 'disculpa']
    };

    for (const [toolName, patterns] of Object.entries(toolPatterns)) {
      if (patterns.some(pattern => content.includes(pattern))) {
        const tool = getToolByName(toolName);
        if (tool) {
          try {
            const toolInput = extractToolInput(content, toolName, agentState.context.user_id);
            const result = await tool.execute(toolInput);
            logger.debug('Herramienta ejecutada exitosamente', { toolName, userId: agentState.context.user_id });
            return result;
          } catch (toolError) {
            logger.error('Error al ejecutar herramienta', {
              toolName,
              userId: agentState.context.user_id,
              error: toolError instanceof Error ? toolError.message : String(toolError)
            });
            return 'Lo siento, tuve un problema al procesar tu solicitud con esa herramienta.';
          }
        }
      }
    }

    // Si no hay herramientas específicas, usar OpenAI para generar respuesta
    try {
      const openAIService = getOpenAIService();
      const aiResponse = await openAIService.generateResponse(messageContent);
      return aiResponse || 'Entiendo tu mensaje. ¿En qué más puedo ayudarte?';
    } catch (aiError) {
      logger.error('Error al generar respuesta con OpenAI, usando fallback', {
        userId: agentState.context.user_id,
        error: aiError instanceof Error ? aiError.message : String(aiError)
      });

      // Fallback a respuestas estáticas
      if (content.includes('hola') || content.includes('buenos')) {
        return '¡Hola! ¿Cómo estás? Estoy aquí para ayudarte.';
      } else if (content.includes('gracias')) {
        return '¡De nada! ¿Hay algo más en lo que pueda asistirte?';
      } else if (content.includes('adiós') || content.includes('chau')) {
        return '¡Hasta luego! Que tengas un excelente día.';
      }

      return 'Entiendo tu mensaje. ¿En qué más puedo ayudarte?';
    }
  }

  /**
   * Procesar mensaje de voz transcrito de WhatsApp
   */
  async processVoiceMessage(waId: string, transcription: string, waMessageId?: string, profileName?: string): Promise<string> {
    try {
      logger.info('Procesando mensaje de voz transcrito', { waId, profileName, transcriptionLength: transcription.length });

      logger.debug('Iniciando procesamiento interno del mensaje de voz', { waId, messageId: waMessageId });

      // El procesamiento es similar al de texto, pero marcamos que viene de voz
      let response: string;
      try {
        response = await this.processTextMessage(waId, transcription, waMessageId, profileName);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.toLowerCase().includes('tool') || errorMessage.toLowerCase().includes('herramienta')) {
          logger.error('Problema con herramienta detectado en mensaje de voz', { waId, error: errorMessage });
        } else if (errorMessage.toLowerCase().includes('estado') || errorMessage.toLowerCase().includes('state') || errorMessage.toLowerCase().includes('validation')) {
          logger.error('Error de validación de estado en mensaje de voz', { waId, error: errorMessage });
        } else {
          logger.error('Fallo en el procesamiento del mensaje de voz', { waId, error: errorMessage });
        }
        response = 'Lo siento, tuve un problema interno al procesar tu mensaje de voz.';
      }

      // Aquí podríamos agregar lógica específica para mensajes de voz
      // como guardar la transcripción original, etc.

      logger.debug('Finalizando procesamiento del mensaje de voz', { waId, messageId: waMessageId });
      return response;
    } catch (error) {
      logger.error('Error crítico al procesar mensaje de voz', {
        waId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 'Lo siento, no pude procesar tu mensaje de voz.';
    }
  }

  /**
   * Obtener historial de conversación para contexto
   */
  async getConversationHistory(waId: string, limit: number = 10): Promise<any[]> {
    try {
      const user = await UserRepository.getUserByWaId(waId);
      if (!user) {
        return [];
      }
      const userId = user.id;

      const agentState = await AgentMemory.loadAgentState(userId);
      if (!agentState) {
        return [];
      }

      const messages = await AgentMemory.getConversationHistory(agentState.session_id, limit);
      return messages.map(msg => ({
        direction: msg.direction,
        type: msg.message_type,
        content: msg.content,
        timestamp: msg.timestamp
      }));
    } catch (error) {
      logger.error('Error al obtener historial de conversación', {
        waId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Limpiar memoria del agente para un usuario
   */
  async clearMemory(waId: string): Promise<void> {
    try {
      const user = await UserRepository.getUserByWaId(waId);
      if (!user) {
        return;
      }
      const userId = user.id;

      const agentState = await AgentMemory.loadAgentState(userId);
      if (agentState) {
        const clearedState = AgentMemory.clearAgentState(agentState);
        await AgentMemory.saveAgentState(userId, clearedState);
      }
      logger.info('Memoria del agente limpiada', { userId });
    } catch (error) {
      logger.error('Error al limpiar memoria del agente', {
        waId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Ejecutar limpieza automática de sesiones expiradas
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      return await AgentMemory.cleanupExpiredSessions();
    } catch (error) {
      logger.error('Error en limpieza automática de sesiones', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }
}