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
  blockedUntil = signal<string | null>(null);
  remainingBlockSeconds = signal<number>(0);
  private blockTimer: ReturnType<typeof setInterval> | null = null;

  currentUser = this.currentUserSignal.asReadonly();
  isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  private inactivityTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = Date.now();
  private readonly SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos

  constructor(private tauriService: TauriService) {
    this.loadUserFromStorage();
  }

  private loadUserFromStorage(): void {
    const userData = sessionStorage.getItem('currentUser');
    if (userData) {
      try {
        const user = JSON.parse(userData);
        this.currentUserSignal.set(user);
        this.isAuthenticatedSignal.set(true);
        this.startInactivityMonitor();
      } catch {
        sessionStorage.removeItem('currentUser');
      }
    }
  }

  private startInactivityMonitor(): void {
    this.stopInactivityMonitor();
    this.lastActivity = Date.now();

    const resetActivity = () => { this.lastActivity = Date.now(); };
    window.addEventListener('mousemove', resetActivity, { passive: true });
    window.addEventListener('keydown', resetActivity, { passive: true });
    window.addEventListener('click', resetActivity, { passive: true });
    window.addEventListener('scroll', resetActivity, { passive: true });

    this.inactivityTimer = setInterval(() => {
      if (Date.now() - this.lastActivity > this.SESSION_TIMEOUT_MS) {
        this.logout();
      }
    }, 60000); // verificar cada minuto
  }

  private stopInactivityMonitor(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  async loadAvailableBases(): Promise<void> {
    const user = this.currentUserSignal();
    if (!user) return;
    try {
      const bases = await this.tauriService.getUserBasesDatos(user.id);
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
      this.startInactivityMonitor();
      this.clearBlocked();
    } else if (response.blocked_until) {
      this.blockedUntil.set(response.blocked_until);
      this.startBlockTimer();
    }

    return response;
  }

  private clearBlocked(): void {
    this.blockedUntil.set(null);
    this.remainingBlockSeconds.set(0);
    if (this.blockTimer) {
      clearInterval(this.blockTimer);
      this.blockTimer = null;
    }
  }

  private startBlockTimer(): void {
    if (this.blockTimer) clearInterval(this.blockTimer);
    this.updateRemainingSeconds();
    this.blockTimer = setInterval(() => {
      this.updateRemainingSeconds();
    }, 1000);
  }

  private updateRemainingSeconds(): void {
    const until = this.blockedUntil();
    if (!until) return;
    const diff = new Date(until).getTime() - Date.now();
    if (diff <= 0) {
      this.blockedUntil.set(null);
      this.remainingBlockSeconds.set(0);
      if (this.blockTimer) {
        clearInterval(this.blockTimer);
        this.blockTimer = null;
      }
      return;
    }
    this.remainingBlockSeconds.set(Math.ceil(diff / 1000));
  }

  async logout(): Promise<void> {
    this.stopInactivityMonitor();

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
