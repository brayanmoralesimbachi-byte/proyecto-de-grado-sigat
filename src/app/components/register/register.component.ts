import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TauriService } from '../../services/tauri.service';

@Component({
  selector: 'app-register',
  imports: [CommonModule, FormsModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent {
  username = signal('');
  password = signal('');
  confirmPassword = signal('');
  errorMessage = signal('');
  successMessage = signal('');
  isLoading = signal(false);

  constructor(
    private tauriService: TauriService,
    private router: Router
  ) {}

  async onRegister(): Promise<void> {
    // Validaciones
    if (!this.username() || !this.password() || !this.confirmPassword()) {
      this.errorMessage.set('Por favor complete todos los campos');
      return;
    }

    if (this.username().length < 3) {
      this.errorMessage.set('El usuario debe tener al menos 3 caracteres');
      return;
    }

    if (this.password().length < 6) {
      this.errorMessage.set('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (this.password() !== this.confirmPassword()) {
      this.errorMessage.set('Las contraseñas no coinciden');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      const result = await this.tauriService.createUser(
        this.username(),
        this.password(),
        'operador'  // Rol por defecto
      );

      this.successMessage.set(result);
      
      // Esperar un momento y redirigir al login
      setTimeout(() => {
        this.router.navigate(['/login']);
      }, 2000);

    } catch (error) {
      this.errorMessage.set('Error al crear usuario: ' + error);
    } finally {
      this.isLoading.set(false);
    }
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
