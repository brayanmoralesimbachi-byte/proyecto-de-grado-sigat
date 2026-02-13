import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Activo, TauriService } from '../../services/tauri.service';

@Component({
  selector: 'app-activos',
  imports: [CommonModule, FormsModule],
  templateUrl: './activos.component.html',
  styleUrls: ['./activos.component.scss']
})
export class ActivosComponent implements OnInit {
  activos = signal<Activo[]>([]);
  showModal = signal(false);
  showImageModal = signal(false);
  selectedImage = signal<string | undefined>(undefined);
  isEditing = signal(false);
  currentActivo = signal<Activo>({
    codigo: '',
    nombre: '',
    descripcion: '',
    categoria: '',
    ubicacion: '',
    responsable_id: undefined,
    estado: 'operativo',
    valor_adquisicion: undefined,
    fecha_adquisicion: ''
  });
  
  errorMessage = signal('');
  successMessage = signal('');
  isLoading = signal(false);

  categorias = ['Equipos de Cómputo', 'Equipos de Telecomunicaciones', 'Mobiliario', 
                'Herramientas', 'Software', 'Otro'];
  estados = ['operativo', 'en_mantenimiento', 'fuera_de_servicio', 'en_reparacion'];

  constructor(
    private tauriService: TauriService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadActivos();
  }

  async loadActivos(): Promise<void> {
    try {
      this.isLoading.set(true);
      const data = await this.tauriService.getActivos();
      this.activos.set(data);
      this.errorMessage.set('');
    } catch (error) {
      this.errorMessage.set('Error al cargar activos');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  openCreateModal(): void {
    this.isEditing.set(false);
    this.currentActivo.set({
      codigo: '',
      nombre: '',
      descripcion: '',
      categoria: this.categorias[0],
      ubicacion: '',
      responsable_id: undefined,
      estado: 'operativo',
      valor_adquisicion: undefined,
      fecha_adquisicion: '',
      imagen_base64: undefined
    });
    this.showModal.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  openEditModal(activo: Activo): void {
    this.isEditing.set(true);
    this.currentActivo.set({ ...activo });
    this.showModal.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  closeModal(): void {
    this.showModal.set(false);
    this.currentActivo.set({
      codigo: '',
      nombre: '',
      descripcion: '',
      categoria: '',
      ubicacion: '',
      responsable_id: undefined,
      estado: 'operativo',
      valor_adquisicion: undefined,
      fecha_adquisicion: '',
      imagen_base64: undefined
    });
  }

  async saveActivo(): Promise<void> {
    const activo = this.currentActivo();
    
    // Validaciones
    if (!activo.codigo || !activo.nombre || !activo.categoria) {
      this.errorMessage.set('Código, nombre y categoría son obligatorios');
      return;
    }

    const user = this.authService.currentUser();
    if (!user) {
      this.errorMessage.set('Usuario no autenticado');
      return;
    }

    try {
      this.isLoading.set(true);
      
      if (this.isEditing() && activo.id) {
        await this.tauriService.updateActivo(activo.id, activo, user.id);
        this.successMessage.set('Activo actualizado exitosamente');
      } else {
        await this.tauriService.createActivo(activo, user.id);
        this.successMessage.set('Activo creado exitosamente');
      }

      await this.loadActivos();
      this.closeModal();
      
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error) {
      this.errorMessage.set(`Error al guardar activo: ${error}`);
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteActivo(id: number): Promise<void> {
    if (!confirm('¿Está seguro de eliminar este activo?')) {
      return;
    }

    const user = this.authService.currentUser();
    if (!user) {
      this.errorMessage.set('Usuario no autenticado');
      return;
    }

    try {
      this.isLoading.set(true);
      await this.tauriService.deleteActivo(id, user.id);
      this.successMessage.set('Activo eliminado exitosamente');
      await this.loadActivos();
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error) {
      this.errorMessage.set(`Error al eliminar activo: ${error}`);
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  getEstadoBadgeClass(estado: string): string {
    const classes: Record<string, string> = {
      'operativo': 'badge-success',
      'en_mantenimiento': 'badge-warning',
      'fuera_de_servicio': 'badge-danger',
      'en_reparacion': 'badge-info'
    };
    return classes[estado] || 'badge-secondary';
  }

  formatCurrency(value?: number): string {
    if (!value) return '-';
    return new Intl.NumberFormat('es-CO', { 
      style: 'currency', 
      currency: 'COP' 
    }).format(value);
  }

  onImageSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      
      // Validar tamaño (máximo 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('La imagen no debe superar los 5MB');
        return;
      }

      // Validar tipo
      if (!file.type.startsWith('image/')) {
        alert('Solo se permiten archivos de imagen');
        return;
      }

      // Convertir a base64
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        this.currentActivo.update(activo => ({
          ...activo,
          imagen_base64: base64
        }));
      };
      reader.readAsDataURL(file);
    }
  }

  removeImage(): void {
    this.currentActivo.update(activo => ({
      ...activo,
      imagen_base64: undefined
    }));
  }

  openImageModal(imagen: string | undefined): void {
    if (imagen) {
      this.selectedImage.set(imagen);
      this.showImageModal.set(true);
    }
  }

  closeImageModal(): void {
    this.showImageModal.set(false);
    this.selectedImage.set(undefined);
  }
}
