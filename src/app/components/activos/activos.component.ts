import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Activo, ActivoDetalle, ActivoVista, Categoria, TauriService } from '../../services/tauri.service';
import { ChatbotComponent } from '../chatbot/chatbot.component';

@Component({
  selector: 'app-activos',
  imports: [CommonModule, FormsModule, ChatbotComponent],
  templateUrl: './activos.component.html',
  styleUrls: ['./activos.component.scss']
})
export class ActivosComponent implements OnInit {
  activos = signal<Activo[]>([]);
  activosFiltrados = signal<Activo[]>([]);
  activosPaginados = signal<Activo[]>([]);
  
  showModal = signal(false);
  showImageModal = signal(false);
  showDetallesModal = signal(false);
  showFiltrosAvanzados = signal(false);
  
  selectedImage = signal<string | undefined>(undefined);
  selectedActivoDetalle = signal<ActivoDetalle | null>(null);
  activoVistas = signal<ActivoVista[]>([]);
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
    fecha_adquisicion: '',
    palabras_clave: '',
    base_datos_id: undefined
  });
  
  errorMessage = signal('');
  successMessage = signal('');
  isLoading = signal(false);

  // Búsqueda y filtros
  searchTerm = signal('');
  filtroEstado = signal('');
  filtroCategoria = signal('');
  
  // Filtros avanzados
  filtroUbicacion = signal('');
  filtroCodigo = signal('');
  filtroPalabrasClave = signal('');
  filtroRangoValor = signal('');
  filtroTiempoVencimiento = signal('');
  filtroBaseDatos = signal<number | undefined>(undefined);

  // Paginación
  currentPage = signal(1);
  itemsPerPage = 40;
  totalPages = signal(1);

  // Categorías dinámicas desde DB
  categoriasDB = signal<Categoria[]>([]);
  categorias = signal<string[]>([]);
  
  estados = ['operativo', 'en_mantenimiento', 'fuera_de_servicio', 'en_reparacion'];
  
  rangosValor = [
    { label: '0 - 50,000', min: 0, max: 50000 },
    { label: '50,000 - 200,000', min: 50000, max: 200000 },
    { label: '200,000 - 500,000', min: 200000, max: 500000 },
    { label: '500,000 - 1,000,000', min: 500000, max: 1000000 },
    { label: '+1,000,000', min: 1000000, max: Infinity }
  ];
  
  tiemposVencimiento = [
    { label: 'Vencido (0%)', min: 0, max: 0 },
    { label: 'Crítico (1-20%)', min: 1, max: 20 },
    { label: 'Advertencia (21-50%)', min: 21, max: 50 },
    { label: 'Normal (51-100%)', min: 51, max: 100 }
  ];

  // Para usar en template
  Math = Math;
  JSON = JSON;

  constructor(
    private tauriService: TauriService,
    public authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadCategorias();
    await this.loadActivos();
    console.log('[Activos] Current user:', this.authService.currentUser());
    console.log('[Activos] isAdmin:', this.isAdmin());
  }

  async loadCategorias(): Promise<void> {
    try {
      const data = await this.tauriService.getCategorias();
      this.categoriasDB.set(data);
      this.categorias.set(data.map(c => c.nombre));
    } catch (error) {
      console.error('Error al cargar categorías:', error);
      // Fallback a categorías vacías
      this.categorias.set([]);
    }
  }

  isAdmin(): boolean {
    const result = this.authService.hasRole('admin');
    return result;
  }

  async loadActivos(): Promise<void> {
    try {
      this.isLoading.set(true);
      const user = this.authService.currentUser();
      const data = await this.tauriService.getActivos(user?.id, this.filtroBaseDatos());
      this.activos.set(data);
      this.aplicarFiltros();
      this.errorMessage.set('');
    } catch (error) {
      this.errorMessage.set('Error al cargar activos');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  aplicarFiltros(): void {
    let resultado = [...this.activos()];
    
    // Búsqueda por término general
    if (this.searchTerm()) {
      const term = this.searchTerm().toLowerCase();
      resultado = resultado.filter(a => 
        a.codigo.toLowerCase().includes(term) ||
        a.nombre.toLowerCase().includes(term) ||
        a.descripcion?.toLowerCase().includes(term) ||
        a.categoria.toLowerCase().includes(term) ||
        a.ubicacion?.toLowerCase().includes(term)
      );
    }

    // Filtro básico de estado
    if (this.filtroEstado()) {
      resultado = resultado.filter(a => a.estado === this.filtroEstado());
    }

    // Filtro básico de categoría
    if (this.filtroCategoria()) {
      resultado = resultado.filter(a => a.categoria === this.filtroCategoria());
    }

    // Filtros avanzados
    if (this.filtroUbicacion()) {
      resultado = resultado.filter(a => 
        a.ubicacion?.toLowerCase().includes(this.filtroUbicacion().toLowerCase())
      );
    }

    if (this.filtroCodigo()) {
      resultado = resultado.filter(a => 
        a.codigo.toLowerCase().includes(this.filtroCodigo().toLowerCase())
      );
    }

    if (this.filtroPalabrasClave()) {
      const palabras = this.filtroPalabrasClave().toLowerCase().split(',').map(p => p.trim());
      resultado = resultado.filter(a => 
        palabras.some(palabra => 
          a.descripcion?.toLowerCase().includes(palabra) ||
          a.palabras_clave?.toLowerCase().includes(palabra) ||
          a.nombre.toLowerCase().includes(palabra)
        )
      );
    }

    if (this.filtroRangoValor()) {
      const rango = JSON.parse(this.filtroRangoValor());
      resultado = resultado.filter(a => {
        const valor = a.valor_adquisicion || 0;
        return valor >= rango.min && valor <= rango.max;
      });
    }

    if (this.filtroTiempoVencimiento()) {
      const tiempo = JSON.parse(this.filtroTiempoVencimiento());
      resultado = resultado.filter(a => {
        if (!a.fecha_adquisicion || !a.fecha_vencimiento) return false;
        const porcentaje = this.calculateVencimientoPercentage(a.fecha_adquisicion, a.fecha_vencimiento);
        return porcentaje >= tiempo.min && porcentaje <= tiempo.max;
      });
    }

    this.activosFiltrados.set(resultado);
    this.totalPages.set(Math.ceil(resultado.length / this.itemsPerPage));
    this.currentPage.set(1); // Reiniciar a página 1
    this.aplicarPaginacion();
  }

  aplicarPaginacion(): void {
    const inicio = (this.currentPage() - 1) * this.itemsPerPage;
    const fin = inicio + this.itemsPerPage;
    this.activosPaginados.set(this.activosFiltrados().slice(inicio, fin));
  }

  onSearchChange(): void {
    this.aplicarFiltros();
  }

  onBaseDatosFilterChange(bdId: number | undefined): void {
    this.filtroBaseDatos.set(bdId);
    this.loadActivos();
  }

  limpiarFiltros(): void {
    this.searchTerm.set('');
    this.filtroEstado.set('');
    this.filtroCategoria.set('');
    this.limpiarFiltrosAvanzados();
  }

  limpiarFiltrosAvanzados(): void {
    this.filtroUbicacion.set('');
    this.filtroCodigo.set('');
    this.filtroPalabrasClave.set('');
    this.filtroRangoValor.set('');
    this.filtroTiempoVencimiento.set('');
    this.aplicarFiltros();
  }

  toggleFiltrosAvanzados(): void {
    this.showFiltrosAvanzados.set(!this.showFiltrosAvanzados());
  }

  cambiarPagina(pagina: number): void {
    if (pagina >= 1 && pagina <= this.totalPages()) {
      this.currentPage.set(pagina);
      this.aplicarPaginacion();
    }
  }

  get paginasArray(): number[] {
    return Array.from({ length: this.totalPages() }, (_, i) => i + 1);
  }

  openCreateModal(): void {
    this.isEditing.set(false);
    const firstBaseId = this.authService.availableBases().length === 1
      ? this.authService.availableBases()[0].id
      : undefined;
    this.currentActivo.set({
      codigo: '',
      nombre: '',
      descripcion: '',
      categoria: this.categorias()[0] || '',
      ubicacion: '',
      responsable_id: undefined,
      estado: 'operativo',
      valor_adquisicion: undefined,
      fecha_adquisicion: '',
      fecha_vencimiento: undefined,
      imagen_base64: undefined,
      palabras_clave: '',
      base_datos_id: firstBaseId
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
      fecha_vencimiento: undefined,
      imagen_base64: undefined,
      palabras_clave: '',
      base_datos_id: undefined
    });
  }

  async saveActivo(): Promise<void> {
    const activo = this.currentActivo();
    
    // Validaciones
    if (!activo.codigo || !activo.nombre || !activo.categoria) {
      this.errorMessage.set('Código, nombre y categoría son obligatorios');
      return;
    }

    if (!activo.base_datos_id) {
      this.errorMessage.set('Debe seleccionar una base de datos');
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
      
      // Validar tamaño (máximo 40MB)
      if (file.size > 40 * 1024 * 1024) {
        alert('La imagen no debe superar los 40MB');
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

  async openDetallesModal(activo: Activo): Promise<void> {
    if (!activo.id) return;

    const user = this.authService.currentUser();
    if (!user) return;

    try {
      this.isLoading.set(true);
      
      // Obtener detalles completos del activo
      const detalles = await this.tauriService.getActivoDetalles(activo.id);
      this.selectedActivoDetalle.set(detalles);

      // Registrar que el usuario vio el activo
      await this.tauriService.registerActivoVista(activo.id, user.id);

      // Obtener historial de vistas
      const vistas = await this.tauriService.getActivoVistas(activo.id);
      this.activoVistas.set(vistas);

      this.showDetallesModal.set(true);
    } catch (error) {
      console.error('Error al abrir detalles:', error);
      this.errorMessage.set('Error al cargar detalles del activo');
    } finally {
      this.isLoading.set(false);
    }
  }

  closeDetallesModal(): void {
    this.showDetallesModal.set(false);
    this.selectedActivoDetalle.set(null);
    this.activoVistas.set([]);
  }

  calculateVencimientoPercentage(fechaAdquisicion?: string, fechaVencimiento?: string): number {
    if (!fechaAdquisicion || !fechaVencimiento) return 100;

    const hoy = new Date();
    // Para fechas tipo DATE (YYYY-MM-DD), crear Date sin conversión de zona horaria
    const [yearAdq, monthAdq, dayAdq] = fechaAdquisicion.split('-').map(Number);
    const adquisicion = new Date(yearAdq, monthAdq - 1, dayAdq);
    
    const [yearVenc, monthVenc, dayVenc] = fechaVencimiento.split('-').map(Number);
    const vencimiento = new Date(yearVenc, monthVenc - 1, dayVenc);

    // Si ya pasó la fecha de vencimiento, retorna 0%
    if (hoy > vencimiento) return 0;

    // Si es el día del vencimiento, retorna 1%
    if (hoy.toDateString() === vencimiento.toDateString()) return 1;

    // Calcular el porcentaje basado en el tiempo restante
    const tiempoTotal = vencimiento.getTime() - adquisicion.getTime();
    const tiempoTranscurrido = hoy.getTime() - adquisicion.getTime();
    const porcentaje = 100 - (tiempoTranscurrido / tiempoTotal * 100);

    return Math.max(1, Math.min(100, porcentaje)); // Entre 1% y 100%
  }

  getVencimientoColor(percentage: number): string {
    if (percentage === 0) return '#000000'; // Negro para vencido
    if (percentage <= 1) return '#ff0000'; // Rojo
    if (percentage <= 20) return '#ff4500'; // Naranja oscuro
    if (percentage <= 40) return '#ff8c00'; // Naranja
    if (percentage <= 60) return '#ffa500'; // Amarillo anaranjado
    if (percentage <= 80) return '#9acd32'; // Verde amarillento
    if (percentage <= 80) return '#32cd32'; // Verde amarillento
    return '#0bd400'; // Verde
  }

  async updateFechaVencimiento(activoId: number, fechaVencimiento: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) {
      this.errorMessage.set('Usuario no autenticado');
      return;
    }

    try {
      this.isLoading.set(true);
      await this.tauriService.updateFechaVencimiento(
        activoId, 
        fechaVencimiento || null, 
        user.id
      );
      
      // Recargar detalles
      const detalles = await this.tauriService.getActivoDetalles(activoId);
      this.selectedActivoDetalle.set(detalles);
      
      // Recargar lista de activos
      await this.loadActivos();
      
      this.successMessage.set('Fecha de vencimiento actualizada');
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch (error) {
      console.error('Error al actualizar fecha:', error);
      this.errorMessage.set('Error al actualizar fecha de vencimiento');
    } finally {
      this.isLoading.set(false);
    }
  }

  formatDateTime(datetime?: string): string {
    if (!datetime) return '-';
    
    // SQLite devuelve timestamps en UTC sin la 'Z', entonces la agregamos
    const dateStr = datetime.includes('T') ? datetime : datetime.replace(' ', 'T');
    const utcDateStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
    
    const date = new Date(utcDateStr);
    const user = this.authService.currentUser();
    const timezone = user?.timezone || 'America/Bogota';
    
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: timezone
    }).format(date);
  }

  formatDate(date?: string): string {
    if (!date) return '-';
    
    // Para fechas tipo DATE (YYYY-MM-DD), no aplicar conversión de zona horaria
    // Solo parsear y formatear localmente
    const [year, month, day] = date.split('-').map(Number);
    
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(year, month - 1, day));
  }
}
