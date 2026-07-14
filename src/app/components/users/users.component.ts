import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BaseDatos, TauriService, UsernameHistory, Usuario } from '../../services/tauri.service';

@Component({
  selector: 'app-users',
  imports: [CommonModule, FormsModule],
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss']
})
export class UsersComponent implements OnInit {
  users = signal<Usuario[]>([]);
  showModal = signal(false);
  showPasswordModal = signal(false);
  showCreateModal = signal(false);
  showHistoryModal = signal(false);
  showAssignmentModal = signal(false);
  selectedUser = signal<Usuario | null>(null);
  usernameHistory = signal<UsernameHistory[]>([]);
  newRole = signal('');
  newPassword = signal('');
  confirmPassword = signal('');
  newUsername = signal('');
  newUserPassword = signal('');
  confirmUserPassword = signal('');
  newUserRole = signal('operador');

  // Asignación de bases de datos
  basesDatos = signal<BaseDatos[]>([]);
  selectedUserBases = signal<BaseDatos[]>([]);
  selectedBasesForUser = signal<Set<number>>(new Set());
  
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

    await Promise.all([this.loadUsers(), this.loadBasesDatos()]);
  }

  async loadBasesDatos(): Promise<void> {
    try {
      this.basesDatos.set(await this.tauriService.getBasesDatos());
    } catch (error) {
      console.error('Error al cargar bases de datos:', error);
    }
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

  openPasswordModal(user: Usuario): void {
    this.selectedUser.set(user);
    this.newPassword.set('');
    this.confirmPassword.set('');
    this.showPasswordModal.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  closePasswordModal(): void {
    this.showPasswordModal.set(false);
    this.selectedUser.set(null);
    this.newPassword.set('');
    this.confirmPassword.set('');
  }

  async openAssignmentModal(user: Usuario): Promise<void> {
    this.selectedUser.set(user);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      this.isLoading.set(true);
      const assigned = await this.tauriService.getUserBasesDatos(user.id);
      this.selectedUserBases.set(assigned);
      this.selectedBasesForUser.set(new Set(assigned.map(b => b.id)));
      this.showAssignmentModal.set(true);
    } catch (error) {
      this.errorMessage.set('Error al cargar asignaciones');
    } finally {
      this.isLoading.set(false);
    }
  }

  closeAssignmentModal(): void {
    this.showAssignmentModal.set(false);
    this.selectedUser.set(null);
    this.selectedUserBases.set([]);
    this.selectedBasesForUser.set(new Set());
    this.errorMessage.set('');
  }

  async toggleBaseDatosAssignment(bdId: number): Promise<void> {
    const user = this.selectedUser();
    const currentUser = this.authService.currentUser();
    if (!user || !currentUser) return;

    const newSet = new Set(this.selectedBasesForUser());
    const isAssigned = newSet.has(bdId);

    try {
      this.isLoading.set(true);
      if (isAssigned) {
        await this.tauriService.unassignUserFromBaseDatos(user.id, bdId, currentUser.id);
        newSet.delete(bdId);
      } else {
        await this.tauriService.assignUserToBaseDatos(user.id, bdId, currentUser.id);
        newSet.add(bdId);
      }
      this.selectedBasesForUser.set(newSet);
      this.selectedUserBases.set(await this.tauriService.getUserBasesDatos(user.id));
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al cambiar asignación');
    } finally {
      this.isLoading.set(false);
    }
  }

  isBaseDatosAssigned(bdId: number): boolean {
    return this.selectedBasesForUser().has(bdId);
  }

  openCreateModal(): void {
    this.newUsername.set('');
    this.newUserPassword.set('');
    this.confirmUserPassword.set('');
    this.newUserRole.set('operador');
    this.showCreateModal.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  closeCreateModal(): void {
    this.showCreateModal.set(false);
    this.newUsername.set('');
    this.newUserPassword.set('');
    this.confirmUserPassword.set('');
    this.newUserRole.set('operador');
  }

  async createUser(): Promise<void> {
    if (!this.newUsername() || !this.newUserPassword() || !this.confirmUserPassword()) {
      this.errorMessage.set('Todos los campos son obligatorios');
      return;
    }

    if (this.newUserPassword().length < 6) {
      this.errorMessage.set('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (this.newUserPassword() !== this.confirmUserPassword()) {
      this.errorMessage.set('Las contraseñas no coinciden');
      return;
    }

    try {
      this.isLoading.set(true);
      await this.tauriService.createUser(this.newUsername(), this.newUserPassword(), this.newUserRole());
      this.successMessage.set(`Usuario ${this.newUsername()} creado exitosamente`);
      this.closeCreateModal();
      await this.loadUsers();
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al crear usuario');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async adminChangePassword(): Promise<void> {
    const user = this.selectedUser();

    if (!user) return;

    if (!this.newPassword()) {
      this.errorMessage.set('La nueva contraseña es obligatoria');
      return;
    }

    if (this.newPassword().length < 6) {
      this.errorMessage.set('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (this.newPassword() !== this.confirmPassword()) {
      this.errorMessage.set('Las contraseñas no coinciden');
      return;
    }

    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      this.errorMessage.set('Usuario no autenticado');
      return;
    }

    try {
      this.isLoading.set(true);
      await this.tauriService.adminChangePassword(currentUser.id, user.id, this.newPassword());
      this.successMessage.set('Contraseña actualizada exitosamente');
      this.closePasswordModal();
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al cambiar contraseña');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
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
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al actualizar rol');
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
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al eliminar usuario');
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
