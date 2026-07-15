import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  username = signal('');
  password = signal('');
  errorMessage = signal('');
  isLoading = signal(false);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async onLogin(): Promise<void> {
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
      } else {
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
}
