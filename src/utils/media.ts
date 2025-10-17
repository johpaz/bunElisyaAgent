import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config.js';
import { logger } from './logger.js';
import {
  MediaDownloadOptions,
  MediaDownloadResult,
  MediaDownloadError
} from '../types/index.js';

/**
 * Función para descargar y preparar archivos media desde WhatsApp
 * Maneja descargas seguras con timeouts y validaciones
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
  options: MediaDownloadOptions = {}
): Promise<MediaDownloadResult> {
  const {
    timeout = 30000, // 30 segundos por defecto
    maxSize = 16 * 1024 * 1024, // 16MB por defecto
    allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'audio/mp3', 'audio/ogg', 'application/pdf']
  } = options;

  try {
    logger.info({ mediaId }, 'Iniciando descarga de media de WhatsApp');

    // Paso 1: Obtener URL temporal del media desde WhatsApp API
    const mediaUrl = await getMediaUrl(mediaId);

    // Paso 2: Descargar el archivo con timeout y límites
    const downloadResult = await downloadFile(mediaUrl, {
      timeout,
      maxSize,
      allowedTypes
    });

    if (!downloadResult.success) {
      throw new MediaDownloadError(`Error descargando archivo: ${downloadResult.error}`, mediaId);
    }

    logger.info({
      mediaId,
      filePath: downloadResult.filePath,
      size: downloadResult.metadata?.size
    }, 'Media descargado exitosamente');

    return downloadResult;

  } catch (error) {
    logger.error({ error, mediaId }, 'Error descargando media de WhatsApp');

    if (error instanceof MediaDownloadError) {
      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: false,
      error: `Error desconocido: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Obtiene la URL temporal del media desde la API de WhatsApp
 */
async function getMediaUrl(mediaId: string): Promise<string> {
  const url = `${config.metaBaseUrl}/${mediaId}`;

  logger.debug({ mediaId, url }, 'Obteniendo URL de media desde WhatsApp API');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.metaToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new MediaDownloadError(
      `Error obteniendo URL de media: ${response.status} ${response.statusText}`,
      mediaId
    );
  }

  const data = await response.json();

  if (!data.url) {
    throw new MediaDownloadError('URL de media no encontrada en respuesta', mediaId);
  }

  return data.url;
}

/**
 * Descarga un archivo desde una URL con validaciones de seguridad
 */
async function downloadFile(
  url: string,
  options: {
    timeout: number;
    maxSize: number;
    allowedTypes: string[];
  }
): Promise<MediaDownloadResult> {
  const { timeout, maxSize, allowedTypes } = options;

  // Crear directorio temporal si no existe
  const tempDir = path.join(process.cwd(), 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  let filePath: string | undefined;

  try {
    // Crear AbortController para timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.metaToken}`,
        'User-Agent': 'Bun-Elysya/1.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Verificar tipo MIME si está disponible
    const contentType = response.headers.get('content-type');
    if (contentType && !allowedTypes.some(type => contentType.startsWith(type))) {
      throw new Error(`Tipo MIME no permitido: ${contentType}`);
    }

    // Obtener extensión de archivo desde el tipo MIME
    const extension = getExtensionFromMimeType(contentType);
    const fileName = `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${extension}`;
    filePath = path.join(tempDir, fileName);

    logger.debug({ url, filePath }, 'Descargando archivo');

    // Verificar tamaño del archivo
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxSize) {
      throw new Error(`Archivo demasiado grande: ${contentLength} bytes (máximo: ${maxSize})`);
    }

    // Descargar archivo con límite de tamaño
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (bytes.length > maxSize) {
      throw new Error(`Archivo descargado demasiado grande: ${bytes.length} bytes (máximo: ${maxSize})`);
    }

    // Escribir archivo
    await fs.writeFile(filePath, bytes);

    logger.debug({
      filePath,
      size: bytes.length,
      contentType
    }, 'Archivo descargado y guardado');

    return {
      success: true,
      filePath,
      metadata: {
        mimeType: contentType || 'application/octet-stream',
        size: bytes.length,
      }
    };

  } catch (error) {
    // Limpiar archivo si existe
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (cleanupError) {
        logger.warn({ cleanupError, filePath }, 'Error limpiando archivo temporal');
      }
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Timeout descargando archivo (${timeout}ms)`);
      }
      throw error;
    }

    throw new Error('Error desconocido durante descarga');
  }
}

function getExtensionFromMimeType(mimeType: string | null): string {
  if (!mimeType) return '';
  const mimeMap: { [key: string]: string } = {
    'audio/ogg': '.ogg',
    'audio/mp3': '.mp3',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/aac': '.aac',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'application/pdf': '.pdf',
  };
  // Extraer el tipo principal, ignorando codecs etc.
  const mainMimeType = mimeType.split(';')[0].trim();
  return mimeMap[mainMimeType] || '';
}

/**
 * Función helper para limpiar archivos temporales antiguos
 * Útil para mantenimiento periódico
 */
export async function cleanupTempFiles(maxAgeHours: number = 24): Promise<void> {
  const tempDir = path.join(process.cwd(), 'temp');

  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    let cleanedCount = 0;

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.stat(filePath);

      if (now - stats.mtime.getTime() > maxAgeMs) {
        await fs.unlink(filePath);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount, maxAgeHours }, 'Archivos temporales limpiados');
    }

  } catch (error) {
    logger.error({ error }, 'Error limpiando archivos temporales');
  }
}