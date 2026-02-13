import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { TauriService } from '../../services/tauri.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit {
  currentUser = signal<any>(null);
  
  // Password change
  oldPassword = signal('');
  newPassword = signal('');
  confirmNewPassword = signal('');
  
  // Username change
  newUsername = signal('');
  
  successMessage = signal('');
  errorMessage = signal('');
  isLoading = signal(false);
  
  activeTab = signal<'password' | 'username'>('password');

  constructor(
    private tauriService: TauriService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    const user = this.authService.currentUser();
    if (user) {
      this.currentUser.set(user);
      this.newUsername.set(user.username);
    } else {
      this.router.navigate(['/login']);
    }
  }

  setActiveTab(tab: 'password' | 'username'): void {
    this.activeTab.set(tab);
    this.clearMessages();
  }

  async changePassword(): Promise<void> {
    this.clearMessages();

    if (!this.oldPassword() || !this.newPassword() || !this.confirmNewPassword()) {
      this.errorMessage.set('Todos los campos son obligatorios');
      return;
    }

    if (this.newPassword() !== this.confirmNewPassword()) {
      this.errorMessage.set('Las contraseñas nuevas no coinciden');
      return;
    }

    if (this.newPassword().length < 6) {
      this.errorMessage.set('La nueva contraseña debe tener al menos 6 caracteres');
      return;
    }

    this.isLoading.set(true);

    try {
      await this.tauriService.changePassword(
        this.currentUser().id,
        this.oldPassword(),
        this.newPassword()
      );

      this.successMessage.set('Contraseña actualizada exitosamente');
      this.oldPassword.set('');
      this.newPassword.set('');
      this.confirmNewPassword.set('');
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al cambiar la contraseña');
    } finally {
      this.isLoading.set(false);
    }
  }

  async changeUsername(): Promise<void> {
    this.clearMessages();

    if (!this.newUsername() || this.newUsername().trim().length === 0) {
      this.errorMessage.set('El nombre de usuario no puede estar vacío');
      return;
    }

    if (this.newUsername() === this.currentUser()?.username) {
      this.errorMessage.set('El nuevo nombre es igual al actual');
      return;
    }

    this.isLoading.set(true);

    try {
      await this.tauriService.changeUsername(
        this.currentUser().id,
        this.newUsername()
      );

      // Actualizar usuario en sessionStorage
      const updatedUser = { ...this.currentUser(), username: this.newUsername() };
      this.currentUser.set(updatedUser);
      sessionStorage.setItem('currentUser', JSON.stringify(updatedUser));

      this.successMessage.set('Nombre de usuario actualizado exitosamente');
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al cambiar el nombre de usuario');
      this.newUsername.set(this.currentUser()?.username || '');
    } finally {
      this.isLoading.set(false);
    }
  }

  clearMessages(): void {
    this.successMessage.set('');
    this.errorMessage.set('');
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  getUserInitial(): string {
    return this.currentUser()?.username?.charAt(0).toUpperCase() || 'U';
  }
}
