import { Injectable, signal } from '@angular/core';
import { LoginRequest, LoginResponse, TauriService } from './tauri.service';

export interface User {
  id: number;
  username: string;
  rol: string;
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
      const user: User = {
        id: response.user_id,
        username: response.username,
        rol: response.rol
      };
      this.currentUserSignal.set(user);
      this.isAuthenticatedSignal.set(true);
      sessionStorage.setItem('currentUser', JSON.stringify(user));
    }

    return response;
  }

  logout(): void {
    this.currentUserSignal.set(null);
    this.isAuthenticatedSignal.set(false);
    sessionStorage.removeItem('currentUser');
  }

  hasRole(rol: string): boolean {
    return this.currentUserSignal()?.rol === rol;
  }
}
