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
  showUsernameConfirm = signal(false);
  pendingNewUsername = signal('');
  
  // Timezone change
  selectedTimezone = signal('America/Bogota');
  
  successMessage = signal('');
  errorMessage = signal('');
  isLoading = signal(false);
  
  activeTab = signal<'password' | 'username' | 'timezone'>('password');

  // Lista de zonas horarias por país
  timezones = [
    { country: 'Colombia', value: 'America/Bogota', label: 'Colombia (América/Bogotá) GMT-5' },
    { country: 'México', value: 'America/Mexico_City', label: 'México (Ciudad de México) GMT-6' },
    { country: 'Argentina', value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires) GMT-3' },
    { country: 'Chile', value: 'America/Santiago', label: 'Chile (Santiago) GMT-3' },
    { country: 'Perú', value: 'America/Lima', label: 'Perú (Lima) GMT-5' },
    { country: 'Venezuela', value: 'America/Caracas', label: 'Venezuela (Caracas) GMT-4' },
    { country: 'Ecuador', value: 'America/Guayaquil', label: 'Ecuador (Guayaquil) GMT-5' },
    { country: 'Bolivia', value: 'America/La_Paz', label: 'Bolivia (La Paz) GMT-4' },
    { country: 'Paraguay', value: 'America/Asuncion', label: 'Paraguay (Asunción) GMT-4' },
    { country: 'Uruguay', value: 'America/Montevideo', label: 'Uruguay (Montevideo) GMT-3' },
    { country: 'Brasil', value: 'America/Sao_Paulo', label: 'Brasil (São Paulo) GMT-3' },
    { country: 'Costa Rica', value: 'America/Costa_Rica', label: 'Costa Rica (San José) GMT-6' },
    { country: 'Panamá', value: 'America/Panama', label: 'Panamá (Panamá) GMT-5' },
    { country: 'España', value: 'Europe/Madrid', label: 'España (Madrid) GMT+1' },
    { country: 'Estados Unidos (Este)', value: 'America/New_York', label: 'EE.UU. (Nueva York) GMT-5' },
    { country: 'Estados Unidos (Centro)', value: 'America/Chicago', label: 'EE.UU. (Chicago) GMT-6' },
    { country: 'Estados Unidos (Montaña)', value: 'America/Denver', label: 'EE.UU. (Denver) GMT-7' },
    { country: 'Estados Unidos (Pacífico)', value: 'America/Los_Angeles', label: 'EE.UU. (Los Ángeles) GMT-8' },
  ];

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
      this.selectedTimezone.set(user.timezone || 'America/Bogota');
    } else {
      this.router.navigate(['/login']);
    }
  }

  setActiveTab(tab: 'password' | 'username' | 'timezone'): void {
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

    this.pendingNewUsername.set(this.newUsername());
    this.showUsernameConfirm.set(true);
  }

  cancelUsernameChange(): void {
    this.showUsernameConfirm.set(false);
    this.pendingNewUsername.set('');
  }

  async confirmUsernameChange(): Promise<void> {
    this.showUsernameConfirm.set(false);
    const newName = this.pendingNewUsername();
    this.pendingNewUsername.set('');
    this.isLoading.set(true);

    try {
      await this.tauriService.changeUsername(
        this.currentUser().id,
        newName
      );

      // Cerrar sesión
      await this.authService.logout();
      this.router.navigate(['/login']);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al cambiar el nombre de usuario');
      this.newUsername.set(this.currentUser()?.username || '');
      this.isLoading.set(false);
    }
  }

  async changeTimezone(): Promise<void> {
    this.clearMessages();

    if (!this.selectedTimezone()) {
      this.errorMessage.set('Debe seleccionar una zona horaria');
      return;
    }

    if (this.selectedTimezone() === this.currentUser()?.timezone) {
      this.errorMessage.set('La zona horaria seleccionada es la misma que la actual');
      return;
    }

    this.isLoading.set(true);

    try {
      await this.tauriService.updateTimezone(
        this.currentUser().id,
        this.selectedTimezone()
      );

      // Actualizar usuario en el servicio de autenticación y sessionStorage
      this.authService.updateUserTimezone(this.selectedTimezone());
      const updatedUser = { ...this.currentUser(), timezone: this.selectedTimezone() };
      this.currentUser.set(updatedUser);

      this.successMessage.set('Zona horaria actualizada exitosamente');
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al cambiar la zona horaria');
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
