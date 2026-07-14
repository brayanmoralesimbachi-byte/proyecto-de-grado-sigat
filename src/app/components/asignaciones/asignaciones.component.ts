import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BaseDatos, TauriService } from '../../services/tauri.service';

@Component({
  selector: 'app-asignaciones',
  imports: [CommonModule, FormsModule],
  templateUrl: './asignaciones.component.html',
  styleUrls: ['./asignaciones.component.scss']
})
export class AsignacionesComponent implements OnInit {
  basesDatos = signal<BaseDatos[]>([]);
  showModal = signal(false);
  isEditing = signal(false);
  editingId = signal<number | null>(null);
  nombre = signal('');
  descripcion = signal('');
  errorMessage = signal('');
  successMessage = signal('');
  isLoading = signal(false);

  constructor(
    private tauriService: TauriService,
    public authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser || !this.authService.hasRole('administrador')) {
      this.errorMessage.set('No tienes permisos para acceder a esta página');
      setTimeout(() => this.router.navigate(['/dashboard']), 2000);
      return;
    }
    await this.loadBasesDatos();
  }

  async loadBasesDatos(): Promise<void> {
    try {
      this.isLoading.set(true);
      const data = await this.tauriService.getBasesDatos();
      this.basesDatos.set(data);
      this.errorMessage.set('');
    } catch (error) {
      this.errorMessage.set('Error al cargar bases de datos');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  openCreateModal(): void {
    this.isEditing.set(false);
    this.editingId.set(null);
    this.nombre.set('');
    this.descripcion.set('');
    this.showModal.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  openEditModal(bd: BaseDatos): void {
    this.isEditing.set(true);
    this.editingId.set(bd.id);
    this.nombre.set(bd.nombre);
    this.descripcion.set(bd.descripcion || '');
    this.showModal.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  closeModal(): void {
    this.showModal.set(false);
    this.isEditing.set(false);
    this.editingId.set(null);
    this.nombre.set('');
    this.descripcion.set('');
  }

  async saveBaseDatos(): Promise<void> {
    if (!this.nombre()) {
      this.errorMessage.set('El nombre es obligatorio');
      return;
    }

    const user = this.authService.currentUser();
    if (!user) { this.errorMessage.set('Usuario no autenticado'); return; }

    try {
      this.isLoading.set(true);
      if (this.isEditing() && this.editingId()) {
        await this.tauriService.updateBaseDatos(this.editingId()!, { nombre: this.nombre(), descripcion: this.descripcion() || undefined }, user.id);
        this.successMessage.set('Base de datos actualizada exitosamente');
      } else {
        await this.tauriService.createBaseDatos({ nombre: this.nombre(), descripcion: this.descripcion() || undefined }, user.id);
        this.successMessage.set('Base de datos creada exitosamente');
      }
      this.closeModal();
      await this.loadBasesDatos();
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al guardar');
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteBaseDatos(id: number): Promise<void> {
    if (!confirm('¿Está seguro de eliminar esta base de datos? Los activos asociados deben reasignarse primero.')) return;

    const user = this.authService.currentUser();
    if (!user) { this.errorMessage.set('Usuario no autenticado'); return; }

    try {
      this.isLoading.set(true);
      await this.tauriService.deleteBaseDatos(id, user.id);
      this.successMessage.set('Base de datos eliminada');
      await this.loadBasesDatos();
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al eliminar');
    } finally {
      this.isLoading.set(false);
    }
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
