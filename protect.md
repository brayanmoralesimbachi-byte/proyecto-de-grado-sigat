
# Detalles Técnicos y Límites del Sistema

## Dashboard
- **Activos recientes:** El dashboard muestra los **5 activos más recientes** registrados, ordenados por fecha de adquisición o creación descendente.
- **Tarjetas de resumen:** Se visualiza el total de activos registrados, usuarios y logs recientes.
- **Navegación:** Acceso rápido a activos, usuarios (solo administradores), auditoría y perfil personal.

## Gestión de Activos
- **CRUD completo:** Crear, editar, eliminar y listar activos.
- **Imágenes:**
	- Cada activo puede tener una imagen (almacenada en base64 en la base de datos).
	- En la tabla de activos se muestra una miniatura de 50x50px si el activo tiene imagen.
	- Al hacer clic en la miniatura, se abre un modal con la imagen en tamaño completo.
	- Si no hay imagen, se muestra el texto "Sin imagen".
- **Campos:** Código, nombre, descripción, categoría, ubicación, responsable, estado, valor de adquisición, fecha de adquisición, imagen.

## Auditoría
- **Logs de auditoría:**
	- Todos los cambios relevantes (crear, editar, eliminar activos, cambios de usuario, etc.) quedan registrados de forma permanente e inalterable.
	- Cada registro incluye: usuario, acción (CREATE, UPDATE, DELETE, LOGIN), tabla afectada, id de registro, valores anteriores y nuevos, timestamp.
	- **Límite de visualización:** Por defecto se muestran **100 registros** en la vista de auditoría, pero el usuario puede elegir entre 50, 100, 200 o 500 registros desde el selector de la interfaz.
	- **Persistencia:** Los logs no se eliminan automáticamente, la base de datos almacena todos los eventos históricos.
	- **Visualización:** Los logs se muestran en una línea de tiempo, con iconos y colores según la acción.

## Usuarios y Seguridad
- **Registro:**
	- El registro de usuarios no permite elegir rol, siempre se asigna "operador" por defecto.
- **Gestión de usuarios:**
	- Solo los administradores pueden ver y modificar usuarios y roles.
	- No es posible eliminarse a sí mismo.
- **Perfil:**
	- Cada usuario puede cambiar su contraseña (requiere la anterior) y su nombre de usuario.
	- El avatar es siempre la inicial del nombre de usuario (no hay foto de perfil).
	- El historial de cambios de nombre de usuario es visible solo para administradores.

## Otros detalles
- **Base de datos:** SQLite cifrada con SQLCipher.
- **Límites técnicos:**
	- Imágenes de activos: máximo 5MB por imagen.
	- Los logs de auditoría no tienen límite de almacenamiento, solo de consulta.
- **Actualización:** 10 de febrero de 2026
