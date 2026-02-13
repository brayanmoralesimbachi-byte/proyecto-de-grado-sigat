import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AuditLog, TauriService } from '../../services/tauri.service';

@Component({
  selector: 'app-audit',
  imports: [CommonModule],
  templateUrl: './audit.component.html',
  styleUrls: ['./audit.component.scss']
})
export class AuditComponent implements OnInit {
  auditLogs = signal<AuditLog[]>([]);
  errorMessage = signal('');
  isLoading = signal(false);
  limit = signal(100);

  constructor(
    private tauriService: TauriService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadAuditLog();
  }

  async loadAuditLog(): Promise<void> {
    try {
      this.isLoading.set(true);
      const data = await this.tauriService.getAuditLog(this.limit());
      this.auditLogs.set(data);
      this.errorMessage.set('');
    } catch (error) {
      this.errorMessage.set('Error al cargar log de auditoría');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async changeLimit(newLimit: number): Promise<void> {
    this.limit.set(newLimit);
    await this.loadAuditLog();
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  getActionBadgeClass(action: string): string {
    const classes: Record<string, string> = {
      'CREATE': 'badge-success',
      'UPDATE': 'badge-warning',
      'DELETE': 'badge-danger',
      'LOGIN': 'badge-info'
    };
    return classes[action] || 'badge-secondary';
  }

  getActionIcon(action: string): string {
    const icons: Record<string, string> = {
      'CREATE': 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
      'UPDATE': 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
      'DELETE': 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
      'LOGIN': 'M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z'
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
