import { Elysia } from 'elysia';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { testConnection } from '../database/client.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { AudioService } from '../services/audioService.js';

/**
 * Rutas relacionadas con el health check del servidor
 * Proporciona información sobre el estado de los servicios
 */

// Variables globales (se configurarán desde index.ts)
let isDatabaseAvailable = false;
let whatsappService: WhatsAppService;
let audioService: AudioService;

export function setHealthCheckDependencies(dbAvailable: boolean, waService: WhatsAppService, auService: AudioService) {
  isDatabaseAvailable = dbAvailable;
  whatsappService = waService;
  audioService = auService;
}

export const healthRoutes = new Elysia({ prefix: '/health' })
  // Ruta GET /health - Health check del servidor
  .get('/', async () => {
    try {
      // Verificar conectividad de servicios
      let dbHealth = false;
      if (config.databaseUrl && isDatabaseAvailable) {
        dbHealth = await testConnection();
      }
      const whatsappHealth = await whatsappService.healthCheck();

      const health = {
        status: whatsappHealth ? (dbHealth ? 'healthy' : 'degraded') : 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealth,
          whatsapp: whatsappHealth,
          transcription: audioService.isTranscriptionAvailable()
        },
        version: '1.0.0'
      };

      logger.debug('Health check solicitado', health);

      return health;
    } catch (error) {
      logger.error('Error en health check', {
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed'
      };
    }
  });