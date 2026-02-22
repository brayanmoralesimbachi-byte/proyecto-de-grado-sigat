import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Activo, ActivoDetalle, ActivoVista, TauriService } from '../../services/tauri.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  activos = signal<Activo[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  successMessage = signal('');
  
  showDetallesModal = signal(false);
  selectedActivoDetalle = signal<ActivoDetalle | null>(null);
  activoVistas = signal<ActivoVista[]>([]);

  constructor(
    public authService: AuthService,
    private tauriService: TauriService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    await this.loadActivos();
  }

  isAdmin(): boolean {
    return this.authService.hasRole('admin');
  }

  async loadActivos(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const activos = await this.tauriService.getActivos();
      this.activos.set(activos);
    } catch (error) {
      this.errorMessage.set('Error al cargar activos: ' + error);
    } finally {
      this.isLoading.set(false);
    }
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  async logout(): Promise<void> {
    await this.authService.logout();
    this.router.navigate(['/']);
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
    const [yearAdq, monthAdq, dayAdq] = fechaAdquisicion.split('-').map(Number);
    const adquisicion = new Date(yearAdq, monthAdq - 1, dayAdq);
    
    const [yearVenc, monthVenc, dayVenc] = fechaVencimiento.split('-').map(Number);
    const vencimiento = new Date(yearVenc, monthVenc - 1, dayVenc);

    if (hoy > vencimiento) return 0;
    if (hoy.toDateString() === vencimiento.toDateString()) return 1;

    const tiempoTotal = vencimiento.getTime() - adquisicion.getTime();
    const tiempoTranscurrido = hoy.getTime() - adquisicion.getTime();
    const porcentaje = 100 - (tiempoTranscurrido / tiempoTotal * 100);

    return Math.max(1, Math.min(100, porcentaje));
  }

  getVencimientoColor(percentage: number): string {
    if (percentage === 0) return '#000000';
    if (percentage <= 1) return '#ff0000';
    if (percentage <= 20) return '#ff4500';
    if (percentage <= 40) return '#ff8c00';
    if (percentage <= 60) return '#ffa500';
    if (percentage <= 80) return '#9acd32';
    return '#32cd32';
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
      
      const detalles = await this.tauriService.getActivoDetalles(activoId);
      this.selectedActivoDetalle.set(detalles);
      
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

  formatDateTime(datetime?: string): string {
    if (!datetime) return '-';
    
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
    
    const [year, month, day] = date.split('-').map(Number);
    
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(year, month - 1, day));
  }
}
