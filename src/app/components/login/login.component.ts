import { CommonModule } from '@angular/common';
import { Component, signal, computed, Signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule, NgOptimizedImage],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  username = signal('');
  password = signal('');
  errorMessage = signal('');
  isLoading = signal(false);
  blockedUntil!: Signal<string | null>;
  remainingBlockSeconds!: Signal<number>;
  isBlocked!: Signal<boolean>;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {
    this.blockedUntil = this.authService.blockedUntil;
    this.remainingBlockSeconds = this.authService.remainingBlockSeconds;
    this.isBlocked = computed(() => this.remainingBlockSeconds() > 0);
  }

  async onLogin(): Promise<void> {
    if (this.isBlocked()) return;

    if (!this.username() || !this.password()) {
      this.errorMessage.set('Por favor ingrese usuario y contraseña');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const response = await this.authService.login(this.username(), this.password());

      if (response.success) {
        this.router.navigate(['/dashboard']);
      } else if (!response.blocked_until) {
        this.errorMessage.set(response.message);
      }
    } catch (error) {
      this.errorMessage.set('Error al intentar iniciar sesión: ' + error);
    } finally {
      this.isLoading.set(false);
    }
  }

  goHome(): void {
    this.router.navigate(['']);
  }

  goToRegister(): void {
    this.router.navigate(['/register']);
  }

  formatBlockTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
