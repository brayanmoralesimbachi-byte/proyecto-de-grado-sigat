import { Injectable, signal } from '@angular/core';
import { LoginRequest, LoginResponse, TauriService } from './tauri.service';

export interface User {
  id: number;
  username: string;
  rol: string;
  timezone?: string;
  loginTimestamp?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSignal = signal<User | null>(null);
  private isAuthenticatedSignal = signal<boolean>(false);

  currentUser = this.currentUserSignal.asReadonly();
  isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  constructor(private tauriService: TauriService) {
    this.loadUserFromStorage();
  }

  private loadUserFromStorage(): void {
    const userData = sessionStorage.getItem('currentUser');
    if (userData) {
      const user = JSON.parse(userData);
      this.currentUserSignal.set(user);
      this.isAuthenticatedSignal.set(true);
    }
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const request: LoginRequest = { username, password };
    const response = await this.tauriService.login(request);

    if (response.success && response.user_id && response.username && response.rol) {
      const loginTimestamp = new Date().toISOString();
      const user: User = {
        id: response.user_id,
        username: response.username,
        rol: response.rol,
        timezone: response.timezone || 'America/Bogota',
        loginTimestamp
      };
      this.currentUserSignal.set(user);
      this.isAuthenticatedSignal.set(true);
      sessionStorage.setItem('currentUser', JSON.stringify(user));
    }

    return response;
  }

  async logout(): Promise<void> {
    const user = this.currentUserSignal();
    if (user && user.loginTimestamp) {
      try {
        await this.tauriService.logout(user.id, user.loginTimestamp);
      } catch (error) {
        console.error('Error al cerrar sesión:', error);
      }
    }
    
    this.currentUserSignal.set(null);
    this.isAuthenticatedSignal.set(false);
    sessionStorage.removeItem('currentUser');
  }

  hasRole(rol: string): boolean {
    const currentRol = this.currentUserSignal()?.rol;
    if (!currentRol) return false;
    
    // Normalizar roles: "admin" y "administrador" son equivalentes
    const normalizedCurrentRol = currentRol.toLowerCase();
    const normalizedCheckRol = rol.toLowerCase();
    
    if (normalizedCheckRol === 'admin') {
      return normalizedCurrentRol === 'admin' || normalizedCurrentRol === 'administrador';
    }
    
    return normalizedCurrentRol === normalizedCheckRol;
  }

  updateUserTimezone(timezone: string): void {
    const user = this.currentUserSignal();
    if (user) {
      const updatedUser = { ...user, timezone };
      this.currentUserSignal.set(updatedUser);
      sessionStorage.setItem('currentUser', JSON.stringify(updatedUser));
    }
  }
}
