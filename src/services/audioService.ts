import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { downloadWhatsAppMedia } from '../utils/media.js';
import { WhatsAppError } from '../types/index.js';

/**
 * Interfaz para opciones de transcripción
 */
export interface TranscriptionOptions {
  language?: string; // Código de idioma (ej: 'es', 'en')
  model?: 'whisper-1' | 'whisper-large-v3'; // Modelo de OpenAI
  temperature?: number; // Temperatura para la transcripción
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json'; // Formato de respuesta
}

/**
 * Interfaz para resultado de transcripción
 */
export interface TranscriptionResult {
  success: boolean;
  text?: string;
  language?: string;
  duration?: number;
  error?: string;
  metadata?: {
    model: string;
    processingTime: number;
  };
}

/**
 * Servicio para manejar descarga y transcripción de audio de WhatsApp
 * Integra descarga de media con transcripción usando OpenAI Whisper API
 */
export class AudioService {
  private readonly openaiApiKey: string;
  private readonly openaiBaseUrl: string = 'https://api.openai.com/v1';

  constructor() {
    this.openaiApiKey = config.apiKeyOpenAI || '';
    if (!this.openaiApiKey) {
      logger.warn('API key de OpenAI no configurada - transcripción no estará disponible');
    }
  }

  /**
   * Procesa un mensaje de audio de WhatsApp: descarga y transcribe
   * @param audioId ID del audio en WhatsApp
   * @param options Opciones de transcripción
   * @returns Resultado de la transcripción
   */
  async processWhatsAppAudio(
    audioId: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    try {
      logger.info({ audioId }, 'Iniciando procesamiento de audio de WhatsApp');

      // Paso 1: Descargar el audio desde WhatsApp
      const downloadResult = await downloadWhatsAppMedia(audioId, {
        timeout: 60000, // 1 minuto para audios
        maxSize: 25 * 1024 * 1024, // 25MB máximo para audios
        allowedTypes: ['audio/ogg', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/aac']
      });

      if (!downloadResult.success || !downloadResult.filePath) {
        throw new WhatsAppError(
          `Error descargando audio: ${downloadResult.error || 'Unknown error'}`
        );
      }

      logger.debug({
        audioId,
        filePath: downloadResult.filePath,
        size: downloadResult.metadata?.size
      }, 'Audio descargado exitosamente');

      // Paso 2: Convertir formato si es necesario
      const convertedPath = await this.convertAudioFormat(downloadResult.filePath);

      // Paso 3: Transcribir el audio
      const transcriptionResult = await this.transcribeAudio(convertedPath, options);

      // Paso 4: Limpiar archivos temporales
      await this.cleanupTempFiles([downloadResult.filePath, convertedPath]);

      logger.info({
        audioId,
        transcriptionLength: transcriptionResult.text?.length || 0,
        language: transcriptionResult.language
      }, 'Audio procesado y transcrito exitosamente');

      return transcriptionResult;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        audioId
      }, 'Error procesando audio de WhatsApp');

      return {
        success: false,
        error: `Error procesando audio: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Transcribe un archivo de audio usando OpenAI Whisper
   * @param audioPath Ruta del archivo de audio
   * @param options Opciones de transcripción
   * @returns Resultado de la transcripción
   */
  async transcribeAudio(
    audioPath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    try {
      if (!this.openaiApiKey) {
        throw new WhatsAppError('API key de OpenAI no configurada');
      }

      logger.info({
        audioPath: path.basename(audioPath),
        options
      }, 'Iniciando transcripción con OpenAI Whisper');

      // Verificar que el archivo existe
      await fs.access(audioPath);

      // Obtener información del archivo
      const stats = await fs.stat(audioPath);
      if (stats.size === 0) {
        throw new WhatsAppError('Archivo de audio vacío');
      }

      // Preparar FormData para la API de OpenAI
      const formData = new FormData();

      // Leer archivo como buffer
      const audioBuffer = await fs.readFile(audioPath);
      const audioBlob = new Blob([new Uint8Array(audioBuffer)]);

      formData.append('file', audioBlob, path.basename(audioPath));
      formData.append('model', options.model || 'whisper-1');

      if (options.language) {
        formData.append('language', options.language);
      }

      if (options.temperature !== undefined) {
        formData.append('temperature', options.temperature.toString());
      }

      if (options.responseFormat) {
        formData.append('response_format', options.responseFormat);
      }

      // Hacer request a OpenAI API
      const response = await fetch(`${this.openaiBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new WhatsAppError(
          `Error en API de OpenAI: ${response.status} ${response.statusText} - ${errorData}`
        );
      }

      const data = await response.json();
      const processingTime = Date.now() - startTime;

      logger.info({
        processingTime: `${processingTime}ms`,
        textLength: data.text?.length || 0,
        language: data.language
      }, 'Transcripción completada exitosamente');

      return {
        success: true,
        text: data.text,
        language: data.language,
        duration: data.duration,
        metadata: {
          model: options.model || 'whisper-1',
          processingTime
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        audioPath: path.basename(audioPath),
        processingTime: `${processingTime}ms`
      }, 'Error en transcripción de audio');

      if (error instanceof WhatsAppError) {
        throw error;
      }

      throw new WhatsAppError(
        `Error en transcripción: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Convierte el formato de audio si es necesario para compatibilidad con Whisper
   * Whisper soporta: mp3, mp4, mpeg, mpga, m4a, wav, webm, flac
   * @param audioPath Ruta del archivo original
   * @returns Ruta del archivo convertido (o original si no necesita conversión)
   */
  private async convertAudioFormat(audioPath: string): Promise<string> {
    try {
      const ext = path.extname(audioPath).toLowerCase();

      // Formatos que Whisper soporta nativamente
      const supportedFormats = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.flac'];

      if (supportedFormats.includes(ext)) {
        logger.debug({ audioPath, ext }, 'Formato de audio soportado, no necesita conversión');
        return audioPath;
      }

      // Para formatos OGG/OGA (comunes en WhatsApp), intentar conversión
      if (ext === '.ogg' || ext === '.oga') {
        logger.debug({ audioPath, ext }, 'Convirtiendo audio OGG a formato compatible');

        // Nota: En un entorno real, aquí usaríamos ffmpeg o similar para conversión
        // Por ahora, asumimos que OGG funciona o lanzamos error
        logger.warn('Conversión de OGG no implementada - asumiendo compatibilidad');
        return audioPath;
      }

      // Para otros formatos, intentar conversión básica
      logger.warn({ audioPath, ext }, 'Formato de audio no soportado, intentando conversión');

      // Aquí iría la lógica de conversión con ffmpeg-wasm o similar
      // Por simplicidad, por ahora devolvemos el archivo original con una advertencia
      return audioPath;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        audioPath
      }, 'Error convirtiendo formato de audio');

      // Devolver archivo original si la conversión falla
      return audioPath;
    }
  }

  /**
   * Limpia archivos temporales después del procesamiento
   * @param filePaths Array de rutas de archivos a eliminar
   */
  private async cleanupTempFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
        logger.debug({ filePath }, 'Archivo temporal limpiado');
      } catch (error) {
        logger.warn({
          error: error instanceof Error ? error.message : 'Unknown error',
          filePath
        }, 'Error limpiando archivo temporal');
      }
    }
  }

  /**
   * Verifica si el servicio de transcripción está disponible
   * @returns true si OpenAI API key está configurada
   */
  isTranscriptionAvailable(): boolean {
    return Boolean(this.openaiApiKey);
  }

  /**
   * Obtiene información sobre formatos de audio soportados
   * @returns Array de extensiones soportadas
   */
  getSupportedFormats(): string[] {
    return ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'flac', 'ogg', 'oga'];
  }

  /**
   * Método helper para validar opciones de transcripción
   */
  private validateTranscriptionOptions(options: TranscriptionOptions): void {
    if (options.temperature !== undefined &&
        (options.temperature < 0 || options.temperature > 1)) {
      throw new WhatsAppError('Temperature debe estar entre 0 y 1');
    }

    if (options.model && !['whisper-1', 'whisper-large-v3'].includes(options.model)) {
      throw new WhatsAppError('Modelo inválido. Use whisper-1 o whisper-large-v3');
    }

    if (options.responseFormat &&
        !['json', 'text', 'srt', 'verbose_json'].includes(options.responseFormat)) {
      throw new WhatsAppError('Formato de respuesta inválido');
    }
  }

  /**
   * Método para transcribir audio desde buffer (para uso avanzado)
   * @param audioBuffer Buffer del audio
   * @param filename Nombre del archivo
   * @param options Opciones de transcripción
   * @returns Resultado de la transcripción
   */
  async transcribeAudioBuffer(
    audioBuffer: ArrayBuffer,
    filename: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    try {
      // Crear archivo temporal
      const tempDir = path.join(process.cwd(), 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const tempPath = path.join(tempDir, `temp_audio_${Date.now()}_${filename}`);
      await fs.writeFile(tempPath, new Uint8Array(audioBuffer));

      // Transcribir
      const result = await this.transcribeAudio(tempPath, options);

      // Limpiar archivo temporal
      await this.cleanupTempFiles([tempPath]);

      return result;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        filename
      }, 'Error transcribiendo buffer de audio');

      return {
        success: false,
        error: `Error transcribiendo buffer: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}