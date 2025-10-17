import { logger } from '../utils/logger.js';

/**
 * Interfaz base para herramientas del agente
 */
export interface AgentTool {
  name: string;
  description: string;
  execute: (input: any) => Promise<any>;
}

/**
 * Herramienta para consultar la hora actual
 */
export class TimeTool implements AgentTool {
  name = 'get_current_time';
  description = 'Obtiene la hora y fecha actual en formato legible';

  async execute(input: any): Promise<string> {
    try {
      const now = new Date();
      const timeString = now.toLocaleString('es-ES', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      logger.debug('Hora consultada', { time: timeString });
      return `La hora actual es: ${timeString}`;
    } catch (error) {
      logger.error('Error al consultar la hora', { error: error instanceof Error ? error.message : String(error) });
      return 'Lo siento, no pude obtener la hora actual.';
    }
  }
}

/**
 * Herramienta para búsqueda web básica (simulada)
 */
export class WebSearchTool implements AgentTool {
  name = 'web_search';
  description = 'Realiza una búsqueda básica en la web sobre un tema específico';

  async execute(input: { query: string }): Promise<string> {
    try {
      const { query } = input;

      if (!query || typeof query !== 'string') {
        return 'Por favor, proporciona un término de búsqueda válido.';
      }

      // Simulación de búsqueda web - en producción se integraría con una API real
      logger.debug('Búsqueda web solicitada', { query });

      // Respuestas simuladas para consultas comunes
      const responses: Record<string, string> = {
        'clima': 'El clima actual en Bogotá es de 18°C con cielo parcialmente nublado.',
        'noticias': 'Las principales noticias del día incluyen avances en tecnología y economía.',
        'tiempo': 'El pronóstico del tiempo para hoy indica condiciones estables.',
        'ayuda': 'Estoy aquí para ayudarte. ¿En qué puedo asistirte?',
        'saludo': '¡Hola! ¿Cómo puedo ayudarte hoy?'
      };

      // Buscar respuesta aproximada
      const lowerQuery = query.toLowerCase();
      for (const [key, response] of Object.entries(responses)) {
        if (lowerQuery.includes(key)) {
          return response;
        }
      }

      // Respuesta genérica
      return `He realizado una búsqueda sobre "${query}". Encontré información relevante que podría ser útil para tu consulta. ¿Te gustaría que profundice en algún aspecto específico?`;
    } catch (error) {
      logger.error('Error en búsqueda web', { error: error instanceof Error ? error.message : String(error) });
      return 'Lo siento, no pude realizar la búsqueda en este momento.';
    }
  }
}

/**
 * Herramienta para calcular operaciones matemáticas básicas
 */
export class CalculatorTool implements AgentTool {
  name = 'calculator';
  description = 'Realiza operaciones matemáticas básicas (suma, resta, multiplicación, división)';

  async execute(input: { expression: string }): Promise<string> {
    try {
      const { expression } = input;

      if (!expression || typeof expression !== 'string') {
        return 'Por favor, proporciona una expresión matemática válida.';
      }

      // Validar que solo contenga caracteres permitidos
      const allowedChars = /^[0-9+\-*/().\s]+$/;
      if (!allowedChars.test(expression)) {
        return 'La expresión contiene caracteres no permitidos. Solo se permiten números y operadores básicos (+, -, *, /, .).';
      }

      // Evaluar la expresión de forma segura
      const result = this.safeEval(expression);

      if (result === null) {
        return 'No pude calcular esa expresión. Verifica que esté correctamente escrita.';
      }

      logger.debug('Cálculo realizado', { expression, result });
      return `El resultado de ${expression} es: ${result}`;
    } catch (error) {
      logger.error('Error en cálculo matemático', { error: error instanceof Error ? error.message : String(error) });
      return 'Lo siento, no pude realizar el cálculo.';
    }
  }

  private safeEval(expression: string): number | null {
    try {
      // Reemplazar operadores de multiplicación y división por caracteres seguros
      const sanitized = expression.replace(/\s+/g, '');

      // Usar Function constructor para evaluación segura
      const result = new Function('return ' + sanitized)();

      if (typeof result === 'number' && isFinite(result)) {
        return result;
      }

      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Herramienta para recordar información del usuario
 */
export class MemoryTool implements AgentTool {
  name = 'remember_info';
  description = 'Guarda información importante sobre el usuario para recordar en futuras conversaciones';

  private memory: Map<string, any> = new Map();

  async execute(input: { key: string; value: any; userId: string }): Promise<string> {
    try {
      const { key, value, userId } = input;

      if (!key || !userId) {
        return 'Se requiere una clave y ID de usuario para guardar información.';
      }

      const memoryKey = `${userId}_${key}`;
      this.memory.set(memoryKey, {
        value,
        timestamp: new Date(),
        userId
      });

      logger.debug('Información guardada en memoria', { userId, key });
      return `He guardado "${key}": ${JSON.stringify(value)} para recordar en futuras conversaciones.`;
    } catch (error) {
      logger.error('Error al guardar información en memoria', { error: error instanceof Error ? error.message : String(error) });
      return 'Lo siento, no pude guardar esa información.';
    }
  }

  getMemory(userId: string, key: string): any {
    const memoryKey = `${userId}_${key}`;
    const item = this.memory.get(memoryKey);
    return item ? item.value : null;
  }

  getAllMemory(userId: string): Record<string, any> {
    const userMemory: Record<string, any> = {};
    const entries = Array.from(this.memory.entries());
    for (const [key, value] of entries) {
      if (key.startsWith(`${userId}_`)) {
        const actualKey = key.replace(`${userId}_`, '');
        userMemory[actualKey] = value.value;
      }
    }
    return userMemory;
  }
}

/**
 * Herramienta para generar respuestas de cortesía
 */
export class CourtesyTool implements AgentTool {
  name = 'courtesy_response';
  description = 'Genera respuestas de cortesía apropiadas para diferentes situaciones';

  async execute(input: { type: 'greeting' | 'thanks' | 'goodbye' | 'apology' | 'help' }): Promise<string> {
    try {
      const { type } = input;

      const responses = {
        greeting: [
          '¡Hola! ¿En qué puedo ayudarte hoy?',
          '¡Buen día! ¿Cómo estás?',
          '¡Hola! Estoy aquí para asistirte.'
        ],
        thanks: [
          '¡De nada! ¿Hay algo más en lo que pueda ayudarte?',
          'Es un placer ayudarte.',
          '¡Con gusto! ¿Necesitas algo más?'
        ],
        goodbye: [
          '¡Hasta luego! Que tengas un excelente día.',
          '¡Adiós! Nos vemos pronto.',
          '¡Hasta la próxima! Cuídate.'
        ],
        apology: [
          'Disculpa si no pude ayudarte como esperabas.',
          'Lamento cualquier inconveniente.',
          'Perdón, intentaré mejorar mi respuesta.'
        ],
        help: [
          'Estoy aquí para ayudarte. ¿Qué necesitas?',
          '¿En qué puedo asistirte hoy?',
          'Cuéntame, ¿cómo puedo ayudarte?'
        ]
      };

      const typeResponses = responses[type];
      if (!typeResponses) {
        return '¿En qué puedo ayudarte?';
      }

      const randomResponse = typeResponses[Math.floor(Math.random() * typeResponses.length)];
      logger.debug('Respuesta de cortesía generada', { type });
      return randomResponse;
    } catch (error) {
      logger.error('Error al generar respuesta de cortesía', { error: error instanceof Error ? error.message : String(error) });
      return '¿En qué puedo ayudarte?';
    }
  }
}

/**
 * Colección de todas las herramientas disponibles para el agente
 */
export const AVAILABLE_TOOLS: AgentTool[] = [
  new TimeTool(),
  new WebSearchTool(),
  new CalculatorTool(),
  new MemoryTool(),
  new CourtesyTool()
];

/**
 * Función helper para encontrar una herramienta por nombre
 */
export function getToolByName(name: string): AgentTool | null {
  return AVAILABLE_TOOLS.find(tool => tool.name === name) || null;
}

/**
 * Función helper para obtener todas las herramientas en formato para LangGraph
 */
export function getToolsForLangGraph(): Array<{ name: string; description: string; func: (input: any) => Promise<any> }> {
  return AVAILABLE_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    func: tool.execute.bind(tool)
  }));
}