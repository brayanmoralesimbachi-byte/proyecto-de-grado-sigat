import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AuditLog, TauriService } from '../../services/tauri.service';

interface LogsPorFecha {
  fecha: string;
  logs: AuditLog[];
  paginas?: { numero: number; logs: AuditLog[] }[];
}

@Component({
  selector: 'app-audit',
  imports: [CommonModule, FormsModule],
  templateUrl: './audit.component.html',
  styleUrls: ['./audit.component.scss']
})
export class AuditComponent implements OnInit {
  auditLogs = signal<AuditLog[]>([]);
  logsAgrupados = signal<LogsPorFecha[]>([]);
  errorMessage = signal('');
  isLoading = signal(false);
  limit = signal(500);
  
  // Filtro por acción
  filtroAccion = signal('');
  acciones: string[] = [];

  constructor(
    private tauriService: TauriService,
    public authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    console.log('[Audit] Current user:', this.authService.currentUser());
    console.log('[Audit] hasRole(admin):', this.authService.hasRole('admin'));
    this.initAcciones();
    await this.loadAuditLog();
  }

  initAcciones(): void {
    const isAdmin = this.authService.hasRole('admin');
    console.log('[Audit] initAcciones - isAdmin:', isAdmin);
    if (isAdmin) {
      this.acciones = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'];
    } else {
      this.acciones = ['CREATE', 'UPDATE', 'DELETE'];
    }
    console.log('[Audit] acciones array:', this.acciones);
  }

  async loadAuditLog(): Promise<void> {
    try {
      this.isLoading.set(true);
      const data = await this.tauriService.getAuditLog(this.limit());
      this.auditLogs.set(data);
      this.aplicarFiltrosYAgrupar();
      this.errorMessage.set('');
    } catch (error) {
      this.errorMessage.set('Error al cargar log de auditoría');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  aplicarFiltrosYAgrupar(): void {
    let logsParaAgrupar = [...this.auditLogs()];

    // Filtrar LOGIN/LOGOUT para usuarios no-admin
    if (!this.authService.hasRole('admin')) {
      logsParaAgrupar = logsParaAgrupar.filter(log => 
        log.action !== 'LOGIN' && log.action !== 'LOGOUT'
      );
    }

    // Aplicar filtro de acción
    if (this.filtroAccion()) {
      logsParaAgrupar = logsParaAgrupar.filter(log => log.action === this.filtroAccion());
    }

    // Agrupar por fecha
    const logsMap = new Map<string, AuditLog[]>();
    
    logsParaAgrupar.forEach(log => {
      const fecha = this.extractFecha(log.timestamp);
      if (!logsMap.has(fecha)) {
        logsMap.set(fecha, []);
      }
      logsMap.get(fecha)!.push(log);
    });

    // Convertir a array y ordenar por fecha descendente
    const agrupados: LogsPorFecha[] = [];
    const fechasOrdenadas = Array.from(logsMap.keys()).sort((a, b) => b.localeCompare(a));

    fechasOrdenadas.forEach(fecha => {
      const logs = logsMap.get(fecha)!;
      
      if (logs.length > 100) {
        // Crear paginación si hay más de 100 logs
        const paginas: { numero: number; logs: AuditLog[] }[] = [];
        const totalPaginas = Math.ceil(logs.length / 100);
        
        for (let i = 0; i < totalPaginas; i++) {
          paginas.push({
            numero: i + 1,
            logs: logs.slice(i * 100, (i + 1) * 100)
          });
        }
        
        agrupados.push({ fecha, logs, paginas });
      } else {
        // Sin paginación
        agrupados.push({ fecha, logs });
      }
    });

    this.logsAgrupados.set(agrupados);
  }

  extractFecha(timestamp: string): string {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  }

  async changeLimit(newLimit: number): Promise<void> {
    this.limit.set(newLimit);
    await this.loadAuditLog();
  }

  onFiltroChange(): void {
    this.aplicarFiltrosYAgrupar();
  }

  limpiarFiltro(): void {
    this.filtroAccion.set('');
    this.aplicarFiltrosYAgrupar();
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  getActionBadgeClass(action: string): string {
    const classes: Record<string, string> = {
      'CREATE': 'badge-success',
      'UPDATE': 'badge-warning',
      'DELETE': 'badge-danger',
      'LOGIN': 'badge-info',
      'LOGOUT': 'badge-info'
    };
    return classes[action] || 'badge-secondary';
  }

  getActionIcon(action: string): string {
    const icons: Record<string, string> = {
      'CREATE': 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
      'UPDATE': 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
      'DELETE': 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
      'LOGIN': 'M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z',
      'LOGOUT': 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z'
    };
    return icons[action] || 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  }

  getTableLabel(tableName: string): string {
    const labels: Record<string, string> = {
      'usuarios': 'Usuarios',
      'activos': 'Activos',
      'auditoria': 'Auditoría'
    };
    return labels[tableName] || tableName;
  }
}
