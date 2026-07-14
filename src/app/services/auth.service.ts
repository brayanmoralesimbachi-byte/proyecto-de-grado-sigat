import { Injectable, signal } from '@angular/core';
import { BaseDatos, LoginRequest, LoginResponse, TauriService } from './tauri.service';

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
  availableBases = signal<BaseDatos[]>([]);
  selectedBaseDatosId = signal<number | null>(null);
  hasLoadedBases = signal(false);

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

  async loadAvailableBases(): Promise<void> {
    const user = this.currentUserSignal();
    if (!user) return;
    try {
      const bases = await this.tauriService.getAvailableBasesDatos(user.id);
      this.availableBases.set(bases);
      this.selectedBaseDatosId.set(bases.length === 1 ? bases[0].id : null);
      this.hasLoadedBases.set(true);
    } catch (error) {
      console.error('Error al cargar bases disponibles:', error);
      this.hasLoadedBases.set(true);
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

  hasMultipleBases(): boolean {
    return this.availableBases().length > 1;
  }

  hasSingleBase(): boolean {
    return this.availableBases().length === 1;
  }

  hasNoBases(): boolean {
    return !this.hasRole('admin') && this.availableBases().length === 0 && this.hasLoadedBases();
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
