import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { TauriService, UsernameHistory, Usuario } from '../../services/tauri.service';

@Component({
  selector: 'app-users',
  imports: [CommonModule, FormsModule],
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss']
})
export class UsersComponent implements OnInit {
  users = signal<Usuario[]>([]);
  showModal = signal(false);
  showHistoryModal = signal(false);
  selectedUser = signal<Usuario | null>(null);
  usernameHistory = signal<UsernameHistory[]>([]);
  newRole = signal('');
  
  errorMessage = signal('');
  successMessage = signal('');
  isLoading = signal(false);

  roles = ['administrador', 'operador', 'auditor'];

  constructor(
    private tauriService: TauriService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    // Verificar que el usuario sea administrador
    const currentUser = this.authService.currentUser();
    if (!currentUser || !this.authService.hasRole('administrador')) {
      this.errorMessage.set('No tienes permisos para acceder a esta página');
      setTimeout(() => this.router.navigate(['/dashboard']), 2000);
      return;
    }

    await this.loadUsers();
  }

  async loadUsers(): Promise<void> {
    try {
      this.isLoading.set(true);
      const data = await this.tauriService.getUsers();
      this.users.set(data);
      this.errorMessage.set('');
    } catch (error) {
      this.errorMessage.set('Error al cargar usuarios');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  openEditRoleModal(user: Usuario): void {
    this.selectedUser.set(user);
    this.newRole.set(user.rol);
    this.showModal.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  closeModal(): void {
    this.showModal.set(false);
    this.selectedUser.set(null);
    this.newRole.set('');
  }

  async updateRole(): Promise<void> {
    const user = this.selectedUser();
    const newRole = this.newRole();
    
    if (!user || !newRole) {
      this.errorMessage.set('Debe seleccionar un rol');
      return;
    }

    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      this.errorMessage.set('Usuario no autenticado');
      return;
    }

    try {
      this.isLoading.set(true);
      await this.tauriService.updateUserRole(user.id, newRole, currentUser.id);
      this.successMessage.set('Rol actualizado exitosamente');
      await this.loadUsers();
      this.closeModal();
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error) {
      this.errorMessage.set(`Error al actualizar rol: ${error}`);
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteUser(userId: number): Promise<void> {
    const currentUser = this.authService.currentUser();
    
    // No permitir eliminarse a sí mismo
    if (currentUser && currentUser.id === userId) {
      this.errorMessage.set('No puedes eliminar tu propio usuario');
      setTimeout(() => this.errorMessage.set(''), 3000);
      return;
    }

    if (!confirm('¿Está seguro de eliminar este usuario? Esta acción no se puede deshacer.')) {
      return;
    }

    if (!currentUser) {
      this.errorMessage.set('Usuario no autenticado');
      return;
    }

    try {
      this.isLoading.set(true);
      await this.tauriService.deleteUser(userId, currentUser.id);
      this.successMessage.set('Usuario eliminado exitosamente');
      await this.loadUsers();
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error) {
      this.errorMessage.set(`Error al eliminar usuario: ${error}`);
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  getRoleBadgeClass(rol: string): string {
    const classes: Record<string, string> = {
      'administrador': 'badge-danger',
      'operador': 'badge-primary',
      'auditor': 'badge-info'
    };
    return classes[rol] || 'badge-secondary';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  isCurrentUser(userId: number): boolean {
    const currentUser = this.authService.currentUser();
    return currentUser ? currentUser.id === userId : false;
  }

  async openUsernameHistoryModal(user: Usuario): Promise<void> {
    this.selectedUser.set(user);
    this.isLoading.set(true);
    this.showHistoryModal.set(true);
    this.errorMessage.set('');

    try {
      const history = await this.tauriService.getUsernameHistory(user.id);
      this.usernameHistory.set(history);
    } catch (error) {
      this.errorMessage.set('Error al cargar historial de nombres');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  closeHistoryModal(): void {
    this.showHistoryModal.set(false);
    this.selectedUser.set(null);
    this.usernameHistory.set([]);
    this.errorMessage.set('');
  }
}
