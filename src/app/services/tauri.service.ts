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
  imagen_base64?: string;
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

@Injectable({
  providedIn: 'root'
})
export class TauriService {

  constructor() { }

  /**
   * Crear un nuevo usuario en el sistema
   */
  async createUser(username: string, password: string, rol: string): Promise<string> {
    try {
      const result = await invoke<string>('create_user', {
        username,
        password,
        rol
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
  async getActivos(): Promise<Activo[]> {
    try {
      const result = await invoke<Activo[]>('get_activos');
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
  async getAuditLog(limit?: number): Promise<AuditLog[]> {
    try {
      const result = await invoke<AuditLog[]>('get_audit_log', { limit });
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
}
