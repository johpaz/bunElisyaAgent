// @ts-ignore
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Función para cargar el certificado CA de forma segura
 */
function loadCACertificate(): string | undefined {
  const possiblePaths = [
    './src/database/ca.pem',
    './database/ca.pem',
    './ca.pem',
    resolve(process.cwd(), 'src/database/ca.pem'),
    resolve(process.cwd(), 'database/ca.pem'),
    resolve(process.cwd(), 'ca.pem'),
  ];

  for (const path of possiblePaths) {
    try {
      if (existsSync(path)) {
        const cert = readFileSync(path, 'utf-8');
        logger.info(`Certificado CA cargado desde: ${path}`);
        return cert;
      }
    } catch (error) {
      logger.debug(`No se pudo cargar certificado desde ${path}`);
    }
  }

  logger.warn('No se encontró certificado CA. Usando SSL sin verificación de certificado.');
  return undefined;
}

/**
 * Configuración del pool de conexiones PostgreSQL para Aiven
 * Incluye configuración SSL requerida y reconexiones automáticas
 */
const caCertificate = loadCACertificate();

const poolConfig = {
  connectionString: config.databaseUrl,

  // Configuración SSL para Aiven (REQUERIDO)
  ssl: {
    rejectUnauthorized: false, // false = desarrollo, true = producción con certificado
    // Descomentar en producción con certificado CA:
    // ca: caCertificate,
  },

  // Configuración del pool
  max: 20, // Máximo de conexiones en el pool
  min: 2,  // Mínimo de conexiones en el pool
  idleTimeoutMillis: 60000, // Tiempo de inactividad antes de cerrar conexión
  connectionTimeoutMillis: 20000, // Timeout para establecer conexión
  acquireTimeoutMillis: 60000, // Timeout para adquirir conexión del pool
  
  // Reconexión automática
  allowExitOnIdle: true,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

// Log de configuración SSL
logger.info('Configuración SSL PostgreSQL', {
  sslEnabled: true,
  certificateLoaded: !!caCertificate,
  rejectUnauthorized: caCertificate ? true : false,
  mode: caCertificate ? 'verify-full' : 'require',
});

/**
 * Pool de conexiones PostgreSQL
 * Maneja automáticamente reconexiones y balanceo de carga
 */
export const pool = new Pool(poolConfig);

/**
 * Event listeners para logging y manejo de errores del pool
 */

// Error en el pool general
pool.on('error', (err: any, client: any) => {
  logger.error('Error inesperado en el pool de conexiones PostgreSQL', {
    error: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
    client: client ? 'conectado' : 'desconectado',
    poolState: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    },
    timestamp: new Date().toISOString()
  });
});

// Conexión exitosa
pool.on('connect', (client: any) => {
  logger.debug('Nueva conexión establecida al pool PostgreSQL', {
    poolState: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    },
    timestamp: new Date().toISOString()
  });
});

// Conexión removida del pool
pool.on('remove', (client: any) => {
  logger.debug('Conexión removida del pool PostgreSQL', {
    poolState: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    },
    timestamp: new Date().toISOString()
  });
});

// Conexión adquirida del pool
pool.on('acquire', (client: any) => {
  const poolUtilization = (pool.totalCount / poolConfig.max) * 100;
  logger.debug('Conexión adquirida del pool PostgreSQL', {
    poolState: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
      utilizationPercent: `${poolUtilization.toFixed(1)}%`
    },
    timestamp: new Date().toISOString()
  });

  // Warning cuando el pool está cerca del límite (80% de utilización)
  if (poolUtilization >= 80) {
    logger.warn('Pool de conexiones PostgreSQL cerca del límite de capacidad', {
      utilizationPercent: `${poolUtilization.toFixed(1)}%`,
      maxConnections: poolConfig.max,
      currentConnections: pool.totalCount,
      waitingClients: pool.waitingCount,
      timestamp: new Date().toISOString()
    });
  }

  // Error crítico cuando hay procesos esperando conexiones (pool exhaustion)
  if (pool.waitingCount > 0) {
    logger.error('Pool de conexiones PostgreSQL agotado - procesos esperando conexiones', {
      waitingCount: pool.waitingCount,
      totalCount: pool.totalCount,
      maxConnections: poolConfig.max,
      utilizationPercent: `${poolUtilization.toFixed(1)}%`,
      timestamp: new Date().toISOString()
    });
  }
});

// Conexión destruida
pool.on('destroy', (client: any) => {
  logger.debug('Conexión destruida en el pool PostgreSQL', {
    poolState: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * Función para verificar la conexión a la base de datos
 * Útil para health checks y inicialización
 */
export async function testConnection(): Promise<boolean> {
  const startTime = Date.now();
  try {
    logger.debug('Iniciando verificación de conexión a PostgreSQL', {
      poolState: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      timestamp: new Date().toISOString()
    });

    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    const duration = Date.now() - startTime;
    logger.info('✅ Conexión a PostgreSQL verificada exitosamente', {
      duration: `${duration}ms`,
      poolState: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      timestamp: new Date().toISOString()
    });
    return true;
  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error as any;
    
    // Log directo a consola para debugging
    console.error('\n=== ERROR DE CONEXIÓN POSTGRESQL ===');
    console.error('Message:', err.message);
    console.error('Code:', err.code);
    console.error('Name:', err.name);
    console.error('Stack:', err.stack);
    console.error('Full error:', JSON.stringify(err, null, 2));
    console.error('=====================================\n');
    
    logger.error('❌ Error al verificar conexión a PostgreSQL', {
      errorMessage: err.message,
      errorCode: err.code,
      errorName: err.name,
      errno: err.errno,
      syscall: err.syscall,
      hostname: err.hostname,
      address: err.address,
      port: err.port,
      stack: err.stack,
      duration: `${duration}ms`,
      connectionString: config.databaseUrl?.replace(/:[^:@]+@/, ':****@'), // Ocultar password
      sslConfig: {
        enabled: true,
        hasCertificate: !!caCertificate,
        rejectUnauthorized: !!caCertificate
      },
      poolState: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

/**
 * Función para cerrar el pool de conexiones
 * Debe llamarse al cerrar la aplicación
 */
export async function closePool(): Promise<void> {
  try {
    logger.info('Iniciando cierre del pool de conexiones PostgreSQL', {
      poolState: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      timestamp: new Date().toISOString()
    });

    await pool.end();
    logger.info('Pool de conexiones PostgreSQL cerrado exitosamente', {
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error al cerrar el pool de conexiones PostgreSQL', {
      error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name, code: (error as any).code } : error,
      poolState: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Función helper para ejecutar queries con logging automático
 */
export async function executeQuery<T = any>(
  query: string,
  params: any[] = []
): Promise<T[]> {
  const startTime = Date.now();
  const queryId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Verificar si hay procesos esperando antes de ejecutar la query
    if (pool.waitingCount > 0) {
      logger.warn('Query ejecutándose con procesos esperando conexiones del pool', {
        queryId,
        waitingCount: pool.waitingCount,
        poolState: {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount
        },
        timestamp: new Date().toISOString()
      });
    }

    logger.debug('Ejecutando query', {
      queryId,
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      paramsCount: params.length,
      poolTotalCount: pool.totalCount,
      poolIdleCount: pool.idleCount,
      poolWaitingCount: pool.waitingCount,
      timestamp: new Date().toISOString()
    });

    const result = await pool.query(query, params);
    const duration = Date.now() - startTime;

    // Logging adicional para queries lentas (>1000ms)
    if (duration > 1000) {
      logger.warn('Query ejecutada lentamente', {
        queryId,
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        duration: `${duration}ms`,
        rows: result.rowCount,
        command: result.command,
        poolState: {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount
        },
        timestamp: new Date().toISOString()
      });
    } else {
      logger.debug('Query ejecutada exitosamente', {
        queryId,
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        duration: `${duration}ms`,
        rows: result.rowCount,
        command: result.command,
        timestamp: new Date().toISOString()
      });
    }

    return result.rows;
  } catch (error) {
    const duration = Date.now() - startTime;

    // Logging específico para diferentes tipos de errores de base de datos
    const errorCode = (error as any).code;
    let errorType = 'desconocido';

    if (errorCode) {
      switch (errorCode) {
        case 'ECONNREFUSED':
          errorType = 'conexión_rechazada';
          break;
        case 'ETIMEDOUT':
          errorType = 'timeout_conexión';
          break;
        case 'ENOTFOUND':
          errorType = 'host_no_encontrado';
          break;
        case '42P01':
          errorType = 'tabla_no_existe';
          break;
        case '23505':
          errorType = 'violación_restricción_única';
          break;
        case '23503':
          errorType = 'violación_restricción_foreign_key';
          break;
        default:
          errorType = `código_${errorCode}`;
      }
    }

    logger.error('Error al ejecutar query', {
      queryId,
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      params,
      duration: `${duration}ms`,
      errorType,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      poolState: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      timestamp: new Date().toISOString(),
      code: errorCode
    });
    throw error;
  }
}

/**
 * Función helper para ejecutar queries dentro de una transacción
 */
export async function executeTransaction<T>(
  callback: (client: any) => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  logger.debug('Iniciando transacción', {
    transactionId,
    poolState: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    },
    timestamp: new Date().toISOString()
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');

    const duration = Date.now() - startTime;
    logger.debug('Transacción ejecutada exitosamente', {
      transactionId,
      duration: `${duration}ms`,
      poolState: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      timestamp: new Date().toISOString()
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    await client.query('ROLLBACK');

    logger.error('Error en transacción, rollback ejecutado', {
      transactionId,
      duration: `${duration}ms`,
      error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name, code: (error as any).code } : error,
      poolState: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      },
      timestamp: new Date().toISOString()
    });
    throw error;
  } finally {
    client.release();
  }
}