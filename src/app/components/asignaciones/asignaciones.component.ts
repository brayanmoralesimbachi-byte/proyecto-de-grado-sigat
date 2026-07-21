import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BaseDatos, TauriService } from '../../services/tauri.service';
import { save, open } from '@tauri-apps/plugin-dialog';
import { downloadDir } from '@tauri-apps/api/path';

type ModalType = 'create' | 'export' | 'import' | null;

@Component({
  selector: 'app-asignaciones',
  imports: [CommonModule, FormsModule],
  templateUrl: './asignaciones.component.html',
  styleUrls: ['./asignaciones.component.scss']
})
export class AsignacionesComponent implements OnInit {
  basesDatos = signal<BaseDatos[]>([]);
  showModal = signal(false);
  modalType = signal<ModalType>(null);
  isEditing = signal(false);
  editingId = signal<number | null>(null);
  nombre = signal('');
  descripcion = signal('');
  errorMessage = signal('');
  successMessage = signal('');
  isLoading = signal(false);

  // Export state
  exportBaseId = signal<number | null>(null);
  exportBaseName = signal('');
  adminPassword = signal('');
  passwordVerified = signal(false);
  isExporting = signal(false);
  exportPassword = signal('');
  exportShowPassword = signal(false);
  exportCopied = signal(false);
  exportDone = signal(false);

  // Confirm delete state
  confirmDeleteId = signal<number | null>(null);

  // Import state
  importPassword = signal('');
  importPasswordVerified = signal(false);
  importFilePath = signal('');
  importFilePassword = signal('');
  isImporting = signal(false);
  importDone = signal(false);
  importResult = signal('');

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
    this.modalType.set('create');
    this.showModal.set(true);
    this.isEditing.set(false);
    this.editingId.set(null);
    this.nombre.set('');
    this.descripcion.set('');
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  openEditModal(bd: BaseDatos): void {
    this.modalType.set('create');
    this.showModal.set(true);
    this.isEditing.set(true);
    this.editingId.set(bd.id);
    this.nombre.set(bd.nombre);
    this.descripcion.set(bd.descripcion || '');
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  closeModal(): void {
    this.showModal.set(false);
    this.modalType.set(null);
    this.isEditing.set(false);
    this.editingId.set(null);
    this.nombre.set('');
    this.descripcion.set('');
    this.adminPassword.set('');
    this.passwordVerified.set(false);
    this.isExporting.set(false);
    this.exportPassword.set('');
    this.exportShowPassword.set(false);
    this.exportCopied.set(false);
    this.exportDone.set(false);
    this.exportBaseId.set(null);
    this.exportBaseName.set('');
    this.importPassword.set('');
    this.importPasswordVerified.set(false);
    this.importFilePath.set('');
    this.importFilePassword.set('');
    this.isImporting.set(false);
    this.importDone.set(false);
    this.importResult.set('');
    this.errorMessage.set('');
  }

  // ========== EXPORT ==========

  openExportModal(bd: BaseDatos): void {
    this.modalType.set('export');
    this.showModal.set(true);
    this.exportBaseId.set(bd.id);
    this.exportBaseName.set(bd.nombre);
    this.adminPassword.set('');
    this.passwordVerified.set(false);
    this.isExporting.set(false);
    this.exportPassword.set('');
    this.exportShowPassword.set(false);
    this.exportCopied.set(false);
    this.exportDone.set(false);
    this.errorMessage.set('');
  }

  async verifyExportPassword(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) { this.errorMessage.set('Usuario no autenticado'); return; }
    if (!this.adminPassword()) { this.errorMessage.set('Ingrese su contraseña'); return; }

    try {
      this.isLoading.set(true);
      this.errorMessage.set('');
      await this.tauriService.verifyAdminPassword(user.id, this.adminPassword());
      this.passwordVerified.set(true);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Contraseña incorrecta');
    } finally {
      this.isLoading.set(false);
    }
  }

  async doExport(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user || !this.exportBaseId()) return;

    const defaultName = `export_${this.exportBaseName().replace(/\s+/g, '_')}.7z`;
    const downloads = await downloadDir();
    const savePath = await save({
      defaultPath: `${downloads}\\${defaultName}`,
      filters: [{ name: 'Archivo cifrado', extensions: ['7z'] }]
    });
    if (!savePath) return;

    try {
      this.isExporting.set(true);
      this.errorMessage.set('');
      const exportPwd = await this.tauriService.exportBaseDatos(
        user.id, this.adminPassword(), this.exportBaseId()!, savePath
      );
      this.exportPassword.set(exportPwd);
      this.exportDone.set(true);
      this.isExporting.set(false);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al exportar');
      this.isExporting.set(false);
    }
  }

  toggleExportPassword(): void {
    this.exportShowPassword.set(!this.exportShowPassword());
  }

  copyExportPassword(): void {
    navigator.clipboard.writeText(this.exportPassword()).then(() => {
      this.exportCopied.set(true);
      setTimeout(() => this.exportCopied.set(false), 2500);
    });
  }

  // ========== IMPORT ==========

  openImportModal(): void {
    this.modalType.set('import');
    this.showModal.set(true);
    this.importPassword.set('');
    this.importPasswordVerified.set(false);
    this.importFilePath.set('');
    this.importFilePassword.set('');
    this.isImporting.set(false);
    this.importDone.set(false);
    this.importResult.set('');
    this.errorMessage.set('');
  }

  async verifyImportPassword(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) { this.errorMessage.set('Usuario no autenticado'); return; }
    if (!this.importPassword()) { this.errorMessage.set('Ingrese su contraseña'); return; }

    try {
      this.isLoading.set(true);
      this.errorMessage.set('');
      await this.tauriService.verifyAdminPassword(user.id, this.importPassword());
      this.importPasswordVerified.set(true);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Contraseña incorrecta');
    } finally {
      this.isLoading.set(false);
    }
  }

  async selectImportFile(): Promise<void> {
    const selected = await open({
      filters: [{ name: 'Archivo cifrado', extensions: ['7z'] }],
      multiple: false
    });
    if (selected) {
      this.importFilePath.set(selected as string);
    }
  }

  async doImport(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;
    if (!this.importFilePath()) { this.errorMessage.set('Seleccione un archivo'); return; }
    if (!this.importFilePassword()) { this.errorMessage.set('Ingrese la contraseña de exportación'); return; }

    try {
      this.isImporting.set(true);
      this.errorMessage.set('');
      this.importResult.set('');
      const result = await this.tauriService.importBaseDatos(
        user.id, this.importPassword(), this.importFilePath(), this.importFilePassword()
      );
      this.importResult.set(result);
      this.importDone.set(true);
      this.isImporting.set(false);
      await this.loadBasesDatos();
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al importar');
      this.isImporting.set(false);
    }
  }

  // ========== CRUD ==========

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

  openConfirmDelete(id: number): void {
    this.confirmDeleteId.set(id);
  }

  cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  async confirmDelete(): Promise<void> {
    const id = this.confirmDeleteId();
    if (!id) return;
    this.confirmDeleteId.set(null);

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
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
