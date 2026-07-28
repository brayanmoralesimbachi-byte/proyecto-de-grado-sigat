import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  user_id?: number;
  username?: string;
  rol?: string;
  timezone?: string;
  blocked_until?: string;
}

export interface Activo {
  id?: number;
  codigo: string;
  nombre: string;
  descripcion?: string;
  categoria: string;
  ubicacion?: string;
  responsable_id?: number;
  estado: string;
  valor_adquisicion?: number;
  fecha_adquisicion?: string;
  fecha_vencimiento?: string;
  imagen_base64?: string;
  imagenes?: string[];
  palabras_clave?: string;
  base_datos_id?: number;
  created_by?: number;
  created_at?: string;
}

export interface ActivoDetalle extends Activo {
  created_by_username?: string;
  base_datos_nombre?: string;
}

export interface ActivoVista {
  user_id: number;
  username: string;
  viewed_at: string;
}

export interface Usuario {
  id: number;
  username: string;
  rol: string;
  created_at: string;
}

export interface UsernameHistory {
  old_username: string;
  new_username: string;
  changed_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number;
  username?: string;
  action: string;
  table_name: string;
  record_id: number;
  old_value?: string;
  new_value?: string;
  timestamp: string;
}

export interface Categoria {
  id?: number;
  nombre: string;
  descripcion?: string;
  color?: string;
  created_at?: string;
}

export interface Keyword {
  id?: number;
  palabra: string;
  palabra_normalizada?: string;
  tipo: string;
  categoria_asociada?: string;
  idioma?: string;
  es_sinonimo_de?: string;
  activo?: boolean;
  created_at?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TauriService {

  constructor() { }

  /**
   * Crear un nuevo usuario en el sistema
   */
  async createUser(username: string, password: string, rol: string, baseDatosIds?: number[], adminId?: number): Promise<string> {
    try {
      const result = await invoke<string>('create_user', {
        username,
        password,
        rol,
        baseDatosIds: baseDatosIds || null,
        adminId: adminId || null
      });
      return result;
    } catch (error) {
      console.error('Error en createUser:', error);
      throw new Error(`Error al crear usuario: ${error}`);
    }
  }

  /**
   * Autenticar un usuario
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    try {
      const result = await invoke<LoginResponse>('login', { request });
      return result;
    } catch (error) {
      console.error('Error en login:', error);
      throw new Error(`Error al iniciar sesión: ${error}`);
    }
  }

  /**
   * Obtener lista de activos
   */
  async getActivos(userId?: number, baseDatosId?: number): Promise<Activo[]> {
    try {
      const result = await invoke<Activo[]>('get_activos', {
        userId: userId || null,
        baseDatosId: baseDatosId || null
      });
      return result;
    } catch (error) {
      console.error('Error en getActivos:', error);
      throw new Error(`Error al obtener activos: ${error}`);
    }
  }

  /**
   * Crear un nuevo activo
   */
  async createActivo(activo: Activo, userId: number): Promise<number> {
    try {
      const result = await invoke<number>('create_activo', { activo, userId });
      return result;
    } catch (error) {
      console.error('Error en createActivo:', error);
      throw new Error(`Error al crear activo: ${error}`);
    }
  }

  /**
   * Actualizar un activo existente
   */
  async updateActivo(id: number, activo: Activo, userId: number): Promise<string> {
    try {
      const result = await invoke<string>('update_activo', { id, activo, userId });
      return result;
    } catch (error) {
      console.error('Error en updateActivo:', error);
      throw new Error(`Error al actualizar activo: ${error}`);
    }
  }

  /**
   * Eliminar un activo
   */
  async deleteActivo(id: number, userId: number): Promise<string> {
    try {
      const result = await invoke<string>('delete_activo', { id, userId });
      return result;
    } catch (error) {
      console.error('Error en deleteActivo:', error);
      throw new Error(`Error al eliminar activo: ${error}`);
    }
  }

  /**
   * Obtener todos los usuarios
   */
  async getUsers(): Promise<Usuario[]> {
    try {
      const result = await invoke<Usuario[]>('get_users');
      return result;
    } catch (error) {
      console.error('Error en getUsers:', error);
      throw new Error(`Error al obtener usuarios: ${error}`);
    }
  }

  /**
   * Actualizar rol de un usuario
   */
  async updateUserRole(userId: number, newRole: string, adminId: number): Promise<string> {
    try {
      const result = await invoke<string>('update_user_role', { userId, newRole, adminId });
      return result;
    } catch (error) {
      console.error('Error en updateUserRole:', error);
      throw new Error(`Error al actualizar rol: ${error}`);
    }
  }

  /**
   * Eliminar un usuario
   */
  async deleteUser(userId: number, adminId: number): Promise<string> {
    try {
      const result = await invoke<string>('delete_user', { userId, adminId });
      return result;
    } catch (error) {
      console.error('Error en deleteUser:', error);
      throw new Error(`Error al eliminar usuario: ${error}`);
    }
  }

  /**
   * Obtener log de auditoría
   */
  async getAuditLog(limit?: number, userId?: number, baseDatosId?: number): Promise<AuditLog[]> {
    try {
      const result = await invoke<AuditLog[]>('get_audit_log', {
        limit,
        userId: userId || null,
        baseDatosId: baseDatosId || null
      });
      return result;
    } catch (error) {
      console.error('Error en getAuditLog:', error);
      throw new Error(`Error al obtener log de auditoría: ${error}`);
    }
  }

  /**
   * Cambiar contraseña de usuario
   */
  async changePassword(userId: number, oldPassword: string, newPassword: string): Promise<string> {
    try {
      const result = await invoke<string>('change_password', { userId, oldPassword, newPassword });
      return result;
    } catch (error) {
      console.error('Error en changePassword:', error);
      throw new Error(`Error al cambiar contraseña: ${error}`);
    }
  }

  /**
   * Cambiar contraseña de otro usuario (solo administrador)
   */
  async adminChangePassword(adminId: number, targetUserId: number, newPassword: string): Promise<string> {
    try {
      const result = await invoke<string>('admin_change_password', { adminId, targetUserId, newPassword });
      return result;
    } catch (error) {
      console.error('Error en adminChangePassword:', error);
      throw new Error(`Error al cambiar contraseña: ${error}`);
    }
  }

  /**
   * Cambiar nombre de usuario
   */
  async changeUsername(userId: number, newUsername: string): Promise<string> {
    try {
      const result = await invoke<string>('change_username', { userId, newUsername });
      return result;
    } catch (error) {
      console.error('Error en changeUsername:', error);
      throw new Error(`Error al cambiar nombre de usuario: ${error}`);
    }
  }

  /**
   * Obtener historial de cambios de nombre de usuario
   */
  async getUsernameHistory(userId: number): Promise<UsernameHistory[]> {
    try {
      const result = await invoke<UsernameHistory[]>('get_username_history', { userId });
      return result;
    } catch (error) {
      console.error('Error en getUsernameHistory:', error);
      throw new Error(`Error al obtener historial de nombres: ${error}`);
    }
  }

  /**
   * Obtener detalles completos de un activo
   */
  async getActivoDetalles(activoId: number): Promise<ActivoDetalle> {
    try {
      const result = await invoke<ActivoDetalle>('get_activo_detalles', { activoId });
      return result;
    } catch (error) {
      console.error('Error en getActivoDetalles:', error);
      throw new Error(`Error al obtener detalles del activo: ${error}`);
    }
  }

  /**
   * Registrar que un usuario vio un activo
   */
  async registerActivoVista(activoId: number, userId: number): Promise<string> {
    try {
      const result = await invoke<string>('register_activo_vista', { activoId, userId });
      return result;
    } catch (error) {
      console.error('Error en registerActivoVista:', error);
      throw new Error(`Error al registrar vista del activo: ${error}`);
    }
  }

  /**
   * Obtener historial de vistas de un activo
   */
  async getActivoVistas(activoId: number): Promise<ActivoVista[]> {
    try {
      const result = await invoke<ActivoVista[]>('get_activo_vistas', { activoId });
      return result;
    } catch (error) {
      console.error('Error en getActivoVistas:', error);
      throw new Error(`Error al obtener vistas del activo: ${error}`);
    }
  }

  /**
   * Actualizar fecha de vencimiento de un activo
   */
  async updateFechaVencimiento(activoId: number, fechaVencimiento: string | null, userId: number): Promise<string> {
    try {
      const result = await invoke<string>('update_fecha_vencimiento', { 
        activoId, 
        fechaVencimiento, 
        userId 
      });
      return result;
    } catch (error) {
      console.error('Error en updateFechaVencimiento:', error);
      throw new Error(`Error al actualizar fecha de vencimiento: ${error}`);
    }
  }

  /**
   * Actualizar zona horaria de un usuario
   */
  async updateTimezone(userId: number, timezone: string): Promise<string> {
    try {
      const result = await invoke<string>('update_timezone', { userId, timezone });
      return result;
    } catch (error) {
      console.error('Error en updateTimezone:', error);
      throw new Error(`Error al actualizar zona horaria: ${error}`);
    }
  }

  /**
   * Cerrar sesión y registrar en auditoría
   */
  async logout(userId: number, loginTimestamp: string): Promise<string> {
    try {
      const result = await invoke<string>('logout', { userId, loginTimestamp });
      return result;
    } catch (error) {
      console.error('Error en logout:', error);
      throw new Error(`Error al cerrar sesión: ${error}`);
    }
  }

  /**
   * Verificar si se puede cerrar la aplicación
   */
  async canCloseApp(): Promise<boolean> {
    try {
      const result = await invoke<boolean>('can_close_app');
      return result;
    } catch (error) {
      console.error('Error en canCloseApp:', error);
      return true; // Por defecto permitir cierre en caso de error
    }
  }

  /**
   * Forzar logout en caso de cierre forzoso
   */
  async forceLogout(): Promise<string> {
    try {
      const result = await invoke<string>('force_logout');
      return result;
    } catch (error) {
      console.error('Error en forceLogout:', error);
      throw new Error(`Error al forzar logout: ${error}`);
    }
  }

  // ==================== MÉTODOS DE CATEGORÍAS ====================

  /**
   * Obtener todas las categorías
   */
  async getCategorias(): Promise<Categoria[]> {
    try {
      const result = await invoke<Categoria[]>('get_categorias');
      return result;
    } catch (error) {
      console.error('Error en getCategorias:', error);
      throw new Error(`Error al obtener categorías: ${error}`);
    }
  }

  /**
   * Crear una nueva categoría
   */
  async createCategoria(categoria: Categoria, userId: number): Promise<number> {
    try {
      const result = await invoke<number>('create_categoria', { categoria, userId });
      return result;
    } catch (error) {
      console.error('Error en createCategoria:', error);
      throw new Error(`Error al crear categoría: ${error}`);
    }
  }

  /**
   * Eliminar una categoría
   */
  async deleteCategoria(id: number, userId: number): Promise<string> {
    try {
      const result = await invoke<string>('delete_categoria', { id, userId });
      return result;
    } catch (error) {
      console.error('Error en deleteCategoria:', error);
      throw new Error(`Error al eliminar categoría: ${error}`);
    }
  }

  // ==================== MÉTODOS DE KEYWORDS ====================

  /**
   * Obtener todas las keywords activas
   */
  async getKeywords(): Promise<Keyword[]> {
    try {
      const result = await invoke<Keyword[]>('get_keywords');
      return result;
    } catch (error) {
      console.error('Error en getKeywords:', error);
      throw new Error(`Error al obtener keywords: ${error}`);
    }
  }

  /**
   * Crear una nueva keyword
   */
  async createKeyword(keyword: Keyword, userId: number): Promise<number> {
    try {
      const result = await invoke<number>('create_keyword', { keyword, userId });
      return result;
    } catch (error) {
      console.error('Error en createKeyword:', error);
      throw new Error(`Error al crear keyword: ${error}`);
    }
  }

  /**
   * Eliminar una keyword (soft delete)
   */
  async deleteKeyword(id: number, userId: number): Promise<string> {
    try {
      const result = await invoke<string>('delete_keyword', { id, userId });
      return result;
    } catch (error) {
      console.error('Error en deleteKeyword:', error);
      throw new Error(`Error al eliminar keyword: ${error}`);
    }
  }

  // ==================== MÉTODOS DE BASES DE DATOS (ASIGNACIONES) ====================

  async getBasesDatos(): Promise<BaseDatos[]> {
    try {
      return await invoke<BaseDatos[]>('get_bases_datos');
    } catch (error) {
      console.error('Error en getBasesDatos:', error);
      throw new Error(`Error al obtener bases de datos: ${error}`);
    }
  }

  async createBaseDatos(baseDatos: { nombre: string; descripcion?: string }, userId: number): Promise<number> {
    try {
      return await invoke<number>('create_base_datos', { baseDatos, userId });
    } catch (error) {
      console.error('Error en createBaseDatos:', error);
      throw new Error(`Error al crear base de datos: ${error}`);
    }
  }

  async updateBaseDatos(id: number, baseDatos: { nombre: string; descripcion?: string }, userId: number): Promise<string> {
    try {
      return await invoke<string>('update_base_datos', { id, baseDatos, userId });
    } catch (error) {
      console.error('Error en updateBaseDatos:', error);
      throw new Error(`Error al actualizar base de datos: ${error}`);
    }
  }

  async deleteBaseDatos(id: number, userId: number): Promise<string> {
    try {
      return await invoke<string>('delete_base_datos', { id, userId });
    } catch (error) {
      console.error('Error en deleteBaseDatos:', error);
      throw new Error(`Error al eliminar base de datos: ${error}`);
    }
  }

  async getUserBasesDatos(targetUserId: number): Promise<BaseDatos[]> {
    try {
      return await invoke<BaseDatos[]>('get_user_bases_datos', { targetUserId });
    } catch (error) {
      console.error('Error en getUserBasesDatos:', error);
      throw new Error(`Error al obtener BD del usuario: ${error}`);
    }
  }

  async assignUserToBaseDatos(targetUserId: number, baseDatosId: number, adminId: number): Promise<string> {
    try {
      return await invoke<string>('assign_user_to_base_datos', { targetUserId, baseDatosId, adminId });
    } catch (error) {
      console.error('Error en assignUserToBaseDatos:', error);
      throw new Error(`Error al asignar BD: ${error}`);
    }
  }

  async unassignUserFromBaseDatos(targetUserId: number, baseDatosId: number, adminId: number): Promise<string> {
    try {
      return await invoke<string>('unassign_user_from_base_datos', { targetUserId, baseDatosId, adminId });
    } catch (error) {
      console.error('Error en unassignUserFromBaseDatos:', error);
      throw new Error(`Error al desasignar BD: ${error}`);
    }
  }

  async getAvailableBasesDatos(userId: number): Promise<BaseDatos[]> {
    try {
      return await invoke<BaseDatos[]>('get_available_bases_datos', { userId });
    } catch (error) {
      console.error('Error en getAvailableBasesDatos:', error);
      throw new Error(`Error al obtener BD disponibles: ${error}`);
    }
  }

  async verifyAdminPassword(adminId: number, password: string): Promise<void> {
    try {
      await invoke<void>('verify_admin_password', { adminId, password });
    } catch (error) {
      console.error('Error en verifyAdminPassword:', error);
      throw new Error(`${error}`);
    }
  }

  async exportBaseDatos(adminId: number, password: string, baseDatosId: number, savePath: string): Promise<string> {
    try {
      return await invoke<string>('export_base_datos', { adminId, password, baseDatosId, savePath });
    } catch (error) {
      console.error('Error en exportBaseDatos:', error);
      throw new Error(`Error al exportar base de datos: ${error}`);
    }
  }

  async importBaseDatos(adminId: number, password: string, filePath: string, importPassword: string): Promise<string> {
    try {
      return await invoke<string>('import_base_datos', { adminId, password, filePath, importPassword });
    } catch (error) {
      console.error('Error en importBaseDatos:', error);
      throw new Error(`Error al importar base de datos: ${error}`);
    }
  }

  async exportBaseDatosExcel(adminId: number, password: string, baseDatosId: number, savePath: string, selectedFields: string[], includeAudits: boolean): Promise<string> {
    try {
      return await invoke<string>('export_base_datos_excel', { adminId, password, baseDatosId, savePath, selectedFields, includeAudits });
    } catch (error) {
      console.error('Error en exportBaseDatosExcel:', error);
      throw new Error(`Error al exportar a Excel: ${error}`);
    }
  }
}

export interface BaseDatos {
  id: number;
  nombre: string;
  descripcion?: string;
  created_at?: string;
  updated_at?: string;
  assigned_at?: string;
}
