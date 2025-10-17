# Bun Elysya - Agente Conversacional WhatsApp

Un agente conversacional inteligente construido con Bun.js, Elysia y LangGraph para integración con WhatsApp Business API.

## Arquitectura

El proyecto sigue una arquitectura modular con los siguientes componentes principales:

- **Elysia**: Framework web para manejar rutas y middlewares
- **LangGraph**: Para la lógica de agentes conversacionales
- **PostgreSQL**: Base de datos para persistencia de datos
- **WhatsApp Business API**: Integración con Meta para mensajería
- **Pino**: Sistema de logging estructurado

### Estructura del Proyecto

```
src/
├── agents/          # Lógica de agentes con LangGraph
├── services/        # Servicios de negocio (WhatsApp, DB, etc.)
├── database/        # Configuración y migraciones de BD
├── types/           # Definiciones de tipos TypeScript
├── utils/           # Utilidades y helpers
└── index.js         # Punto de entrada de la aplicación
```

## Instalación

### Prerrequisitos

- Bun.js instalado
- PostgreSQL corriendo
- Cuenta de WhatsApp Business API configurada

### Pasos de Instalación

1. Clona el repositorio:
   ```bash
   git clone <url-del-repo>
   cd bun-elysya
   ```

2. Instala las dependencias:
   ```bash
   bun install
   ```

3. Configura las variables de entorno:
   ```bash
   cp .env.example .env
   # Edita .env con tus valores reales
   ```

4. Configura la base de datos:
   ```bash
   # Asegúrate de que PostgreSQL esté corriendo
   # Crea la base de datos especificada en DATABASE_URL
   ```

## Configuración

### Variables de Entorno

Copia `.env.example` a `.env` y configura:

- `META_TOKEN`: Token de acceso de WhatsApp Business API
- `META_VERIFY_TOKEN`: Token de verificación para webhooks
- `WHATSAPP_PHONE_NUMBER_ID`: ID del número de teléfono de WhatsApp
- `DATABASE_URL`: URL de conexión a PostgreSQL
- `PORT`: Puerto donde correrá el servidor (default: 4000)

### Webhook de WhatsApp

1. En tu aplicación de Meta for Developers, configura el webhook URL:
   ```
   https://tu-dominio.com/webhook
   ```

2. El `META_VERIFY_TOKEN` debe coincidir con el configurado en Meta.

## Uso

### Desarrollo

```bash
bun run dev
```

### Producción

```bash
bun run build
bun run start
```

## Integración de Webhook

El webhook maneja mensajes entrantes de WhatsApp. Los endpoints principales son:

- `GET /webhook`: Verificación inicial de Meta
- `POST /webhook`: Procesamiento de mensajes entrantes

### Manejo de Mensajes

- **Texto**: Procesados por el agente LangGraph para generar respuestas
- **Voz**: Convertidos a texto usando servicios de STT (por implementar)
- **Multimedia**: Soportados pero procesados como texto descriptivo

### Flujo de Conversación

1. Usuario envía mensaje a WhatsApp
2. Webhook recibe el mensaje
3. Se valida y procesa el contenido
4. LangGraph ejecuta la lógica del agente
5. Se genera respuesta basada en el contexto
6. Respuesta se envía de vuelta vía WhatsApp API

## Ejemplo de Conversación

```
Usuario: Hola, ¿cómo estás?
Agente: ¡Hola! Estoy bien, gracias. ¿En qué puedo ayudarte hoy?

Usuario: Quiero información sobre productos
Agente: Claro, tenemos varios productos disponibles. ¿Qué tipo de producto te interesa?

Usuario: Electrónicos
Agente: Excelente elección. Ofrecemos laptops, teléfonos y tablets. ¿Cuál te gustaría conocer mejor?
```

## Despliegue

### Opciones de Despliegue

1. **Vercel/Netlify**: Para despliegue serverless
2. **Railway/Render**: Para aplicaciones full-stack
3. **VPS propio**: Para mayor control

### Consideraciones de Producción

- Configurar variables de entorno correctamente
- Usar HTTPS obligatorio para webhooks de WhatsApp
- Monitorear logs y métricas
- Configurar backups de base de datos

## Buenas Prácticas

### Seguridad

- Nunca commitear el archivo `.env`
- Usar HTTPS en producción
- Validar todos los inputs de usuario
- Implementar rate limiting

### Logging

- Usar Pino para logging estructurado
- Configurar diferentes niveles de log por entorno
- Monitorear errores y excepciones

### Base de Datos

- Usar migraciones para cambios de esquema
- Implementar conexiones pool
- Manejar transacciones apropiadamente

### Testing

- Escribir tests unitarios para lógica de negocio
- Tests de integración para endpoints
- Tests end-to-end para flujos completos

## Contribución

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agrega nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## Soporte

Para soporte técnico o preguntas:
- Abre un issue en GitHub
- Revisa la documentación de WhatsApp Business API
- Consulta la documentación de Elysia y LangGraph