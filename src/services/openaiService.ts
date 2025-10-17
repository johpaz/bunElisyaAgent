import { ChatOpenAI } from '@langchain/openai';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Servicio para interactuar con OpenAI usando LangChain
 */
export class OpenAIService {
  private model: ChatOpenAI;

  constructor() {
    if (!config.apiKeyOpenAI) {
      throw new Error('API_KEY_OPENAI no está configurada');
    }

    this.model = new ChatOpenAI({
      openAIApiKey: config.apiKeyOpenAI,
      modelName: config.openAIModel,
      temperature: 0.7,
      maxTokens: 10000,
      timeout: config.openAITimeout,
    });

    logger.info(`OpenAI service initialized with model: ${config.openAIModel}`);
  }

  /**
   * Genera una respuesta usando el modelo OpenAI
   * @param prompt El prompt para generar la respuesta
   * @param context Contexto adicional (opcional)
   * @returns La respuesta generada o null si hay error
   */
  async generateResponse(prompt: string, context?: string): Promise<string | null> {
    try {
      const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;

      logger.debug(`Generating response for prompt: ${prompt.substring(0, 100)}...`);

      const response = await this.model.invoke([
        {
          role: 'user',
          content: fullPrompt,
        },
      ]);

      const content = response.content as string;

      logger.debug(`Generated response: ${content.substring(0, 100)}...`);

      return content;
    } catch (error) {
      logger.error('Error generating response with OpenAI:', error);

      // Fallback a respuesta estática
      return this.getFallbackResponse(prompt);
    }
  }

  /**
   * Respuesta de fallback cuando OpenAI falla
   */
  private getFallbackResponse(prompt: string): string {
    logger.warn('Using fallback response due to OpenAI error');

    // Respuestas estáticas basadas en el tipo de mensaje
    const lowerPrompt = prompt.toLowerCase();

    if (lowerPrompt.includes('hola') || lowerPrompt.includes('hello')) {
      return '¡Hola! ¿En qué puedo ayudarte hoy?';
    }

    if (lowerPrompt.includes('ayuda') || lowerPrompt.includes('help')) {
      return 'Estoy aquí para ayudarte. ¿Qué necesitas?';
    }

    if (lowerPrompt.includes('gracias') || lowerPrompt.includes('thank')) {
      return '¡De nada! ¿Hay algo más en lo que pueda asistirte?';
    }

    return 'Lo siento, no pude procesar tu mensaje correctamente. ¿Puedes intentarlo de nuevo?';
  }

  /**
   * Verifica si el servicio está disponible
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.generateResponse('test');
      return true;
    } catch {
      return false;
    }
  }
}

// Instancia singleton del servicio
let openAIServiceInstance: OpenAIService | null = null;

/**
 * Obtiene la instancia del servicio OpenAI
 */
export function getOpenAIService(): OpenAIService {
  if (!openAIServiceInstance) {
    openAIServiceInstance = new OpenAIService();
  }
  return openAIServiceInstance;
}